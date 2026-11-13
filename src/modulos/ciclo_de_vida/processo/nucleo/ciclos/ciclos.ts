// Os três ciclos de vida: o de cada Demanda, Rodada e Ticket, e o mapa de estado para Etapa. Os da demanda e da rodada
// saem do catálogo de Etapas: a ordem do SDLC, o Gate de cada Etapa e para onde ela leva. O motor só põe os estados dele
// (os terminais, a execução das rodadas e o cancelamento da demanda).
import { z } from "zod";
import { CicloDeVida } from "./ciclo_de_vida.ts";
import {
  CATALOGO_DE_ETAPAS,
  type DeclaracoesDasEtapas,
  type DefinicaoDoCatalogo,
  type EtapaTicket,
  type NomeGate,
  ORDEM_DO_SDLC,
} from "../../../etapas/publico.ts";
import { existe } from "../../../../../shared/nucleo/erros.ts";

type Escopo = DefinicaoDoCatalogo["escopo"];

const CONCLUIDA = "concluida";
const CANCELADA = "cancelada";
const ARQUIVADA = "arquivada";

// Os estados de cada escopo no tipo, pela mesma regra que monta as transições abaixo: os do motor que a ordem do SDLC
// cita, e os de cada Etapa do escopo (o dela e o de espera do Gate, quando há), na ordem e fora dela (`seguePara`).
type EstadosDaEtapa<Declaracao> = Declaracao extends {
  nome: infer NomeDaEtapa;
  gate: { nome: infer NomeDoGate; esperaEmEstadoProprio: true };
}
  ? NomeDaEtapa | NomeDoGate
  : Declaracao extends { nome: infer NomeDaEtapa }
    ? NomeDaEtapa
    : never;
type NaOrdemDoSdlc<E extends Escopo> = (typeof ORDEM_DO_SDLC)[E][number];
type ForaDaOrdemDoSdlc<E extends Escopo> = Extract<DeclaracoesDasEtapas[EtapaTicket], { escopo: E; seguePara: string }>;
type EstadosDoEscopo<E extends Escopo> =
  | Exclude<NaOrdemDoSdlc<E>, EtapaTicket>
  | EstadosDaEtapa<DeclaracoesDasEtapas[Extract<NaOrdemDoSdlc<E>, EtapaTicket>]>
  | EstadosDaEtapa<ForaDaOrdemDoSdlc<E>>;

/** Os estados do ciclo da demanda, o que o banco e a API gravam. */
export type EstadoDemanda = EstadosDoEscopo<"demanda"> | typeof CONCLUIDA | typeof ARQUIVADA | typeof CANCELADA;
/** Os estados do ciclo da rodada, o que o banco e a API gravam. */
export type EstadoRodada = EstadosDoEscopo<"rodada"> | typeof CONCLUIDA;
type EstadoDoCiclo = EstadoDemanda | EstadoRodada;

const definicaoDoEstado = (estado: string): DefinicaoDoCatalogo | undefined =>
  Object.values(CATALOGO_DE_ETAPAS).find((definicao) => definicao.nome === estado);

/** Os estados da Etapa (o dela e o de espera do Gate, quando há) com os destinos de cada um. */
function transicoesDaEtapa({ nome, gate, devolvePara }: DefinicaoDoCatalogo, seguinte: string): [string, string[]][] {
  const devolucao = devolvePara === undefined ? [] : [devolvePara];
  if (gate?.esperaEmEstadoProprio) {
    return [
      [nome, [gate.nome, ...devolucao]],
      [gate.nome, [gate.reprovadoVaiPara, seguinte]],
    ];
  }
  return [[nome, [seguinte, ...(gate ? [gate.reprovadoVaiPara] : []), ...devolucao]]];
}

/** O caminho feliz do escopo, na ordem do SDLC, e depois as Etapas fora dele (as que declaram `seguePara`). */
function transicoesDoEscopo(escopo: Escopo): [string, string[]][] {
  const ordem: readonly string[] = ORDEM_DO_SDLC[escopo];
  const doCaminhoFeliz = ordem.flatMap((estado, posicao) => {
    const seguinte = ordem[posicao + 1] ?? CONCLUIDA;
    const definicao = definicaoDoEstado(estado);
    return definicao ? transicoesDaEtapa(definicao, seguinte) : [[estado, [seguinte]] as [string, string[]]];
  });
  const foraDoCaminhoFeliz = Object.values(CATALOGO_DE_ETAPAS).flatMap((definicao) =>
    definicao.escopo === escopo && definicao.seguePara !== undefined
      ? transicoesDaEtapa(definicao, definicao.seguePara)
      : [],
  );
  return [...doCaminhoFeliz, ...foraDoCaminhoFeliz];
}

const TRANSICOES_DA_DEMANDA = transicoesDoEscopo("demanda");
const TRANSICOES_DA_RODADA = transicoesDoEscopo("rodada");

/** A demanda em andamento sempre pode ser cancelada; a concluída ainda pode ser arquivada. */
const transicoesComOsTerminaisDaDemanda = (): Record<string, string[]> => ({
  ...Object.fromEntries(
    TRANSICOES_DA_DEMANDA.map(([estado, destinos]) => [estado, [...new Set([...destinos, CANCELADA])]]),
  ),
  [CONCLUIDA]: [ARQUIVADA],
  [ARQUIVADA]: [],
  [CANCELADA]: [],
});

const estadosDe = (transicoes: [string, string[]][]): string[] => transicoes.map(([estado]) => estado);

const TRANSICOES_DA_DEMANDA_COM_OS_TERMINAIS = transicoesComOsTerminaisDaDemanda() as Record<
  EstadoDemanda,
  EstadoDemanda[]
>;
const TRANSICOES_DA_RODADA_COM_A_CONCLUSAO = Object.fromEntries([...TRANSICOES_DA_RODADA, [CONCLUIDA, []]]) as Record<
  EstadoRodada,
  EstadoRodada[]
>;

// Os casts valem porque `ciclos.test.ts` confere os estados derivados, um a um, com o tipo derivado acima.
export const EstadoDemanda = z.enum(
  Object.keys(TRANSICOES_DA_DEMANDA_COM_OS_TERMINAIS) as [EstadoDemanda, ...EstadoDemanda[]],
);
export const EstadoRodada = z.enum(
  Object.keys(TRANSICOES_DA_RODADA_COM_A_CONCLUSAO) as [EstadoRodada, ...EstadoRodada[]],
);

// Os estados do ticket são do motor; os da demanda e da rodada saem do catálogo de Etapas.
export const EstadoTicket = z.enum(["aberto", "em_execucao", "concluido", "falhou", "cancelado"]);
export type EstadoTicket = z.infer<typeof EstadoTicket>;

export const CICLO_DA_DEMANDA = new CicloDeVida<EstadoDemanda>({
  transicoes: TRANSICOES_DA_DEMANDA_COM_OS_TERMINAIS,
  terminais: [CONCLUIDA, ARQUIVADA, CANCELADA],
  satisfazemDependencia: [CONCLUIDA, ARQUIVADA],
  emAndamento: estadosDe(TRANSICOES_DA_DEMANDA) as EstadoDemanda[],
});

export const CICLO_DA_RODADA = new CicloDeVida<EstadoRodada>({
  transicoes: TRANSICOES_DA_RODADA_COM_A_CONCLUSAO,
  terminais: [CONCLUIDA],
  satisfazemDependencia: [CONCLUIDA],
  emAndamento: estadosDe(TRANSICOES_DA_RODADA) as EstadoRodada[],
});

// `aberto` volta a `aberto` quando a Fabriquinha repete o registro do conflito ou da integração do encerramento.
export const CICLO_DO_TICKET = new CicloDeVida<EstadoTicket>({
  transicoes: {
    aberto: ["aberto", "em_execucao", "concluido", "falhou", "cancelado"],
    em_execucao: ["aberto", "concluido", "falhou", "cancelado"],
    falhou: ["aberto", "cancelado"],
    concluido: [],
    cancelado: [],
  },
  terminais: ["concluido", "cancelado"],
  satisfazemDependencia: ["concluido"],
  emAndamento: ["aberto", "em_execucao"],
});

const ETAPA_DO_ESTADO = new Map<string, EtapaTicket>(
  Object.values(CATALOGO_DE_ETAPAS).flatMap(({ nome, gate }) => [
    [nome, nome] as const,
    ...(gate?.esperaEmEstadoProprio ? [[gate.nome, nome] as const] : []),
  ]),
);

/** A Etapa do trabalho de um estado: o próprio nome, ou a do ticket que o Gate espera; sem Etapa, `undefined`. */
export const etapaDoEstado = (estado: EstadoDoCiclo): EtapaTicket | undefined => ETAPA_DO_ESTADO.get(estado);

/** A Etapa que abre a demanda: o ticket 1 dela, criado no registro. */
export const PRIMEIRA_ETAPA_DA_DEMANDA: EtapaTicket = ORDEM_DO_SDLC.demanda[0];
/** A Etapa que abre cada rodada: a dos tickets do Plano, que a aprovação e as correções criam. */
export const PRIMEIRA_ETAPA_DA_RODADA: EtapaTicket = ORDEM_DO_SDLC.rodada[0];

/** A Etapa que vem depois do estado na ordem do SDLC: a que a transição abre ao sair dele. */
export function etapaSeguinte(estado: EstadoDoCiclo): EtapaTicket {
  const ordens: (readonly string[])[] = [ORDEM_DO_SDLC.demanda, ORDEM_DO_SDLC.rodada];
  const ordem = ordens.find((ordemDoEscopo) => ordemDoEscopo.includes(estado)) ?? [];
  return existe(
    definicaoDoEstado(ordem[ordem.indexOf(estado) + 1] ?? ""),
    `nenhuma etapa segue o estado ${estado}`,
    "confira a ordem do SDLC no catálogo",
  ).nome;
}

/** O estado da demanda em que a Etapa trabalha: o nome dela. */
export const estadoDaDemandaNaEtapa = (etapa: EtapaTicket): EstadoDemanda => EstadoDemanda.parse(etapa);
/** O estado da rodada em que a Etapa trabalha: o nome dela. */
export const estadoDaRodadaNaEtapa = (etapa: EtapaTicket): EstadoRodada => EstadoRodada.parse(etapa);

/**
 * O Gate da rodada que espera gente no estado (ou na Etapa): o do estado de espera dele, e o que leva, ao reprovar, à
 * sessão com o Auditor. Ali o Despacho não despacha, e o ticket da sessão não ocupa vaga.
 */
export const gateQueEsperaGenteNaRodada = (estado: EstadoRodada | EtapaTicket): NomeGate | undefined =>
  Object.values(CATALOGO_DE_ETAPAS)
    .filter(({ escopo }) => escopo === "rodada")
    .find(({ gate }) => gate?.esperaEmEstadoProprio && (gate.nome === estado || gate.reprovadoVaiPara === estado))?.gate
    ?.nome;

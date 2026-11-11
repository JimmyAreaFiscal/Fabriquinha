// Os três ciclos de vida: o de cada Demanda, Rodada e Ticket, e o mapa de estado para Etapa. Os da demanda e da rodada
// saem do catálogo de Etapas: a ordem do SDLC, o Gate de cada Etapa e para onde ela leva. O motor só põe os estados dele
// (os terminais, a execução das rodadas e o cancelamento da demanda).
import { CicloDeVida } from "./ciclo_de_vida.ts";
import type { NomeGate } from "../demanda/agregado_demanda.ts";
import type { DefinicaoDaEtapa } from "../../../etapas/definicao/definicao_da_etapa.ts";
import { CATALOGO_DE_ETAPAS, ORDEM_DO_SDLC } from "../../../etapas/catalogo.ts";
import { existe } from "../../../compartilhado/nucleo/erros.ts";
import {
  EstadoDemanda,
  EstadoRodada,
  type EstadoTicket,
  type EtapaTicket,
} from "../../../compartilhado/nucleo/primitivos.ts";

type EstadoDoCiclo = EstadoDemanda | EstadoRodada;
type Escopo = DefinicaoDaEtapa["escopo"];

const CONCLUIDA = "concluida";
const CANCELADA = "cancelada";
const ARQUIVADA = "arquivada";

const definicaoDoEstado = (estado: string): DefinicaoDaEtapa | undefined =>
  Object.values(CATALOGO_DE_ETAPAS).find((definicao) => definicao.nome === estado);

/** Os estados da Etapa (o dela e o de espera do Gate, quando há) com os destinos de cada um. */
function transicoesDaEtapa({ nome, gate, devolvePara }: DefinicaoDaEtapa, seguinte: string): [string, string[]][] {
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

// O cast vale porque `ciclos.test.ts` confere que os estados derivados são exatamente os de `EstadoDemanda`.
export const CICLO_DA_DEMANDA = new CicloDeVida<EstadoDemanda>({
  transicoes: transicoesComOsTerminaisDaDemanda() as Record<EstadoDemanda, EstadoDemanda[]>,
  terminais: [CONCLUIDA, ARQUIVADA, CANCELADA],
  satisfazemDependencia: [CONCLUIDA, ARQUIVADA],
  emAndamento: estadosDe(TRANSICOES_DA_DEMANDA) as EstadoDemanda[],
});

// O cast vale porque `ciclos.test.ts` confere que os estados derivados são exatamente os de `EstadoRodada`.
export const CICLO_DA_RODADA = new CicloDeVida<EstadoRodada>({
  transicoes: Object.fromEntries([...TRANSICOES_DA_RODADA, [CONCLUIDA, []]]) as Record<EstadoRodada, EstadoRodada[]>,
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

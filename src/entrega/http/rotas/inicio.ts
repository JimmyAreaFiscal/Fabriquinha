// Rota do Início (comparacao-sdlc §9.1, "Board com demanda"): numa leitura só, o mês corrente de todos os projetos, o que
// aguarda o Auditor, as sessões que rodam e o board, tudo das demandas em andamento. As concluídas, canceladas e
// arquivadas ficam fora; a navegação conta o que aguarda pela mesma rota.
import type { DatabaseSync } from "node:sqlite";
import type { ModoTrabalho } from "../../../nucleo/trabalho_agentico.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../../nucleo/agregado_demanda.ts";
import { satisfazDependencia } from "../../../nucleo/cancelamento_demanda.ts";
import { CICLO_DO_TICKET } from "../../../nucleo/ciclos.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../../nucleo/demanda.ts";
import type { MotivoDeRecusa } from "../../../nucleo/despacho.ts";
import { Endereco } from "../../../nucleo/item_de_trabalho.ts";
import type { EtapaTicket, EstadoDemanda, EstadoRodada, EstadoTicket } from "../../../nucleo/primitivos.ts";
import { ultimasRecusas } from "../../../aplicacao/despacho.ts";
import { pendenciasDasDemandas, situacaoDoCondutor } from "../../../aplicacao/consultas/pendencias.ts";
import { type SessaoDeDemanda, sessoesDeDemanda } from "../../../aplicacao/historico_demanda.ts";
import { mesDe } from "../../../nucleo/periodo.ts";
import { type MetricasDoMes, metricasDosMeses } from "../../../aplicacao/metricas/metricas_do_periodo.ts";
import { listarDemandas } from "../../../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../../../armazenamento/dependencias_demanda.ts";
import { ticketsComPiAtivo } from "../../../armazenamento/trabalho_agentico.ts";
import { RecusasDoDespacho } from "../../contrato/despacho.ts";
import type { PendenciaDoInicio } from "../../contrato/demanda.ts";
import type { Rota } from "../rotas.ts";

/** Um ticket como o Início o mostra; `modo` é o da sessão ativa dele, quando tem. */
interface TicketDoInicio {
  ref: string;
  etapa: EtapaTicket;
  estado: EstadoTicket;
  modo?: ModoTrabalho;
  /** Com execução de pi aberta: o `em_execucao` é o pi, não o sistema. */
  pi_ativo?: true;
}

/** Uma sessão que roda, com o que o agente faz: o que o processo vivo diz ou, sem ele, o título do ticket. */
export type SessaoRodando = SessaoDeDemanda & { fazendo?: string };

/**
 * A coluna do board: o estado da demanda antes e depois da execução e, na execução, o estado de cada rodada (o encerramento
 * da demanda tem nome próprio, para não se confundir com o da rodada).
 */
export type ColunaDoBoard =
  | Exclude<EstadoDemanda, "em_execucao" | "encerrar_demanda" | "concluida" | "arquivada" | "cancelada">
  | "encerramento_demanda"
  | Exclude<EstadoRodada, "concluida">;

/** Um cartão do board: a demanda (`I-n`) ou, na execução, uma rodada dela (`I-n.Rm`). */
export interface CartaoDoBoard {
  coluna: ColunaDoBoard;
  ref: string;
  demanda: string;
  projeto: string;
  titulo: string;
  /** O ticket em curso: o falho ou em execução antes do aberto. */
  ticket?: TicketDoInicio;
  /** Quantos outros tickets do cartão ainda não terminaram. */
  outros: number;
  /** As predecessoras que ainda não satisfazem a dependência. */
  bloqueios: string[];
}

export interface DadosDoInicio {
  mes: MetricasDoMes;
  aguarda: PendenciaDoInicio[];
  rodando: SessaoRodando[];
  /** As demandas em andamento, que o board distribui nos cartões. */
  quantidadeEmAndamento: number;
  board: CartaoDoBoard[];
}

/** O ticket em curso de uma lista e quantos outros ainda não terminaram. */
function ticketEmCurso(
  tickets: readonly TicketDemanda[],
  modoDe: (ref: string) => ModoTrabalho | undefined,
  comPiAtivo: ReadonlySet<string>,
) {
  const abertos = tickets.filter((t) => !CICLO_DO_TICKET.ehTerminal(t.estado));
  const [ticket] = abertos.toSorted((a, b) => Number(a.estado === "aberto") - Number(b.estado === "aberto"));
  return {
    ...(ticket && { ticket: ticketDoInicio(ticket, modoDe, comPiAtivo) }),
    outros: Math.max(abertos.length - 1, 0),
  };
}

function ticketDoInicio(
  t: TicketDemanda,
  modoDe: (ref: string) => ModoTrabalho | undefined,
  comPiAtivo: ReadonlySet<string> = new Set(),
): TicketDoInicio {
  const ref = formatarTicketRef(t);
  const modo = modoDe(ref);
  return {
    ref,
    etapa: t.etapa,
    estado: t.estado,
    ...(modo && { modo }),
    ...(comPiAtivo.has(ref) && { pi_ativo: true }),
  };
}

/**
 * A coluna da demanda que tem nome diferente do estado: o encerramento dela e a execução sem rodada aberta (antes da
 * primeira ou depois da última, até a revisão abrir), que fica no Desenvolvimento.
 */
const COLUNA_DO_ESTADO: Partial<Record<EstadoDemanda, ColunaDoBoard>> = {
  em_execucao: "implementar",
  encerrar_demanda: "encerramento_demanda",
};

/** Os cartões da demanda: um por rodada que não concluiu, na execução; senão, um só, o da demanda. */
function cartoesDaDemanda(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  modoDe: (ref: string) => ModoTrabalho | undefined,
  comPiAtivo: ReadonlySet<string>,
) {
  const { id: demanda, projeto, titulo, estado } = ag.demanda;
  const bloqueios = predecessorasDaDemanda(banco, demanda)
    .filter((p) => !satisfazDependencia(p.estado))
    .map((p) => p.demanda_id);
  const identificacao = { demanda, projeto, titulo, bloqueios };
  const abertas = ag.rodadas.filter((r) => r.estado !== "concluida");
  if (estado === "em_execucao" && abertas.length > 0) {
    return abertas.map((r): CartaoDoBoard => ({
      coluna: r.estado as ColunaDoBoard,
      ref: formatarRodadaRef(r),
      ...identificacao,
      ...ticketEmCurso(
        ag.tickets.filter((t) => t.rodada_id === r.rodada_id),
        modoDe,
        comPiAtivo,
      ),
    }));
  }
  const coluna = COLUNA_DO_ESTADO[estado] ?? (estado as ColunaDoBoard);
  const globais = ag.tickets.filter((t) => t.rodada_id === undefined);
  return [{ coluna, ref: demanda, ...identificacao, ...ticketEmCurso(globais, modoDe, comPiAtivo) }];
}

/** `GET /api/inicio`. */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function inicio(banco: DatabaseSync, situacaoDa = situacaoDoCondutor, agora = new Date()): DadosDoInicio {
  const mes = mesDe(agora);
  // Um mês pedido, um mês devolvido.
  const [doMes] = metricasDosMeses(banco, { de: mes, ate: mes }) as [MetricasDoMes];
  const demandas = listarDemandas(banco, { soNaoTerminadas: true });
  // Só as sessões das demandas em andamento: calcular o estado de todas as do banco custa segundos.
  const sessoes = demandas.flatMap((ag) => sessoesDeDemanda(banco, { escopo: "ativas", demanda: ag.demanda.id }));
  const modos = new Map(sessoes.map((s) => [s.ticket, s.modo]));
  const modoDe = (ref: string) => modos.get(ref);
  const comPiAtivo = ticketsComPiAtivo(banco);
  const tituloDoTicket = new Map(
    demandas.flatMap((ag) => ag.tickets.map((t) => [formatarTicketRef(t), t.titulo] as const)),
  );
  return {
    mes: doMes,
    aguarda: pendenciasDasDemandas(banco, demandas, sessoes, situacaoDa, agora),
    rodando: sessoes
      .filter((s) => s.estado === "rodando")
      .map((s) => {
        const fazendo = situacaoDa(s.sessao)?.atividade ?? tituloDoTicket.get(s.ticket);
        return { ...s, ...(fazendo !== undefined && { fazendo }) };
      }),
    quantidadeEmAndamento: demandas.length,
    board: demandas.flatMap((ag) => cartoesDaDemanda(banco, ag, modoDe, comPiAtivo)),
  };
}

/** Um motivo de recusa como JSON: os Endereços saem pelo texto público (`I-1.T2`). */
export const recusaEmJson = (motivo: MotivoDeRecusa): unknown =>
  JSON.parse(
    JSON.stringify(motivo, (_chave, valor: unknown) => (valor instanceof Endereco ? valor.toString() : valor)),
  );

/** `GET /api/despacho`: por que cada item parado no último ciclo do Despacho não foi despachado. */
const recusasDoDespacho = () => ({
  recusas: [...ultimasRecusas()].map(([item, motivo]) => ({ item: item.toString(), motivo: recusaEmJson(motivo) })),
});

export const ROTAS_DO_INICIO: Rota[] = [
  { metodo: "GET", caminho: "/api/inicio", tratar: ({ banco }) => inicio(banco) },
  { metodo: "GET", caminho: "/api/despacho", tratar: recusasDoDespacho, resposta: RecusasDoDespacho },
];

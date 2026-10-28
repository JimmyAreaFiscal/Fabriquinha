// Rota do Início (comparacao-sdlc §9.1, "Board com issue"): numa leitura só, o mês corrente de todos os projetos, o que
// aguarda o Auditor, as sessões que rodam e o board, tudo das demandas em andamento. As concluídas, canceladas e
// arquivadas ficam fora; a navegação conta o que aguarda pela mesma rota.
import type { DatabaseSync } from "node:sqlite";
import type { ModoExecucao } from "../../dominio/agregado.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../dominio/agregado_demanda.ts";
import { satisfazDependencia } from "../../dominio/cancelamento_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../dominio/demanda.ts";
import type { EtapaTicket, FaseDemanda, FaseRodada, Instante, StatusTicket } from "../../dominio/primitivos.ts";
import { type Situacao, situacao } from "../../execucao/gerente.ts";
import { type SessaoDeDemanda, sessoesDeDemanda } from "../../execucao/historico_demanda.ts";
import { mesDe } from "../../metricas/periodo.ts";
import { type MetricasMesDemanda, metricasDemandaPorMes } from "../../metricas/periodo_demanda.ts";
import { listarDemandas } from "../../persistencia/demandas.ts";
import { predecessorasDaDemanda } from "../../persistencia/dependencias_demanda.ts";
import type { Rota } from "../rotas.ts";
import { prDaRodada } from "./demandas.ts";

/** Por que o Auditor é esperado: os três gates, a sessão de ajustes do PR, o ticket falho e a sessão parada nele. */
export type MotivoDaEspera =
  "gate_demanda" | "gate_planejamento" | "gate_pr" | "ajustes" | "falha" | "dialogo" | "conversa";

/** Um ticket como o Início o mostra; `modo` é o da sessão ativa dele, quando tem. */
export interface TicketDoInicio {
  ref: string;
  etapa: EtapaTicket;
  status: StatusTicket;
  modo?: ModoExecucao;
}

/** O ticket de uma espera: sem o status, que a espera já diz pelo motivo. */
export type TicketDaEspera = Omit<TicketDoInicio, "status">;

/** O que aguarda o Auditor; `rodada` quando é de uma rodada, e o PR, o erro ou a pergunta conforme o motivo. */
export interface EsperaDoAuditor {
  motivo: MotivoDaEspera;
  demanda: string;
  rodada?: string;
  projeto: string;
  titulo: string;
  ticket?: TicketDaEspera;
  /** A sessão do diálogo ou da conversa, que se responde no chat. */
  sessao?: string;
  pr?: { id: string; url: string };
  erro?: string;
  pergunta?: string;
  desde: Instante;
}

/** Uma sessão que roda, com o que o agente faz: o que o processo vivo diz ou, sem ele, o título do ticket. */
export type SessaoRodando = SessaoDeDemanda & { fazendo?: string };

/**
 * A coluna do board: a fase da demanda antes e depois da execução e, na execução, a fase de cada rodada (o encerramento
 * da demanda tem nome próprio, para não se confundir com o da rodada).
 */
export type ColunaDoBoard =
  | Exclude<FaseDemanda, "execucao" | "encerramento" | "concluida" | "arquivada" | "cancelada">
  | "encerramento_demanda"
  | Exclude<FaseRodada, "concluida">;

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
  mes: MetricasMesDemanda;
  aguarda: EsperaDoAuditor[];
  rodando: SessaoRodando[];
  /** As demandas em andamento, que o board distribui nos cartões. */
  emAndamento: number;
  board: CartaoDoBoard[];
}

const TERMINADO: ReadonlySet<StatusTicket> = new Set(["concluido", "fechado", "cancelado"]);

/** O ticket em curso de uma lista e quantos outros ainda não terminaram. */
function ticketEmCurso(tickets: readonly TicketDemanda[], modoDe: (ref: string) => ModoExecucao | undefined) {
  const abertos = tickets.filter((t) => !TERMINADO.has(t.status));
  const [ticket] = abertos.toSorted((a, b) => Number(a.status === "aberto") - Number(b.status === "aberto"));
  return { ...(ticket && { ticket: ticketDoInicio(ticket, modoDe) }), outros: Math.max(abertos.length - 1, 0) };
}

function ticketDoInicio(t: TicketDemanda, modoDe: (ref: string) => ModoExecucao | undefined): TicketDoInicio {
  const ref = formatarTicketRef(t);
  const modo = modoDe(ref);
  return { ref, etapa: t.etapa, status: t.status, ...(modo && { modo }) };
}

/**
 * A coluna da demanda que tem nome diferente da fase: o encerramento dela e a execução sem rodada aberta (antes da
 * primeira ou depois da última, até a revisão abrir), que fica no Desenvolvimento.
 */
const COLUNA_DA_FASE: Partial<Record<FaseDemanda, ColunaDoBoard>> = {
  execucao: "desenvolvimento",
  encerramento: "encerramento_demanda",
};

/** Os cartões da demanda: um por rodada que não concluiu, na execução; senão, um só, o da demanda. */
function cartoesDaDemanda(banco: DatabaseSync, ag: AgregadoDemanda, modoDe: (ref: string) => ModoExecucao | undefined) {
  const { id: demanda, projeto, titulo, fase } = ag.demanda;
  const bloqueios = predecessorasDaDemanda(banco, demanda)
    .filter((p) => !satisfazDependencia(p.fase))
    .map((p) => p.demanda_id);
  const identificacao = { demanda, projeto, titulo, bloqueios };
  const abertas = ag.rodadas.filter((r) => r.fase !== "concluida");
  if (fase === "execucao" && abertas.length > 0) {
    return abertas.map((r): CartaoDoBoard => ({
      coluna: r.fase as ColunaDoBoard,
      ref: formatarRodadaRef(r),
      ...identificacao,
      ...ticketEmCurso(
        ag.tickets.filter((t) => t.rodada_id === r.rodada_id),
        modoDe,
      ),
    }));
  }
  const coluna = COLUNA_DA_FASE[fase] ?? (fase as ColunaDoBoard);
  const globais = ag.tickets.filter((t) => t.rodada_id === undefined);
  return [{ coluna, ref: demanda, ...identificacao, ...ticketEmCurso(globais, modoDe) }];
}

/** Os gates, as sessões de ajustes e os tickets falhos da demanda, que esperam o Auditor sem depender da sessão. */
function esperasDaDemanda(ag: AgregadoDemanda, modoDe: (ref: string) => ModoExecucao | undefined): EsperaDoAuditor[] {
  const { id: demanda, projeto, titulo, fase, fase_alterada_em } = ag.demanda;
  const identificacao = { demanda, projeto, titulo };
  const ticketGlobal = (etapa: EtapaTicket) =>
    ag.tickets.findLast((t) => t.etapa === etapa && t.rodada_id === undefined);
  const ticketDaEspera = (t: TicketDemanda | undefined) => {
    if (!t) return undefined;
    const { status: _, ...ticket } = ticketDoInicio(t, modoDe);
    return { ticket };
  };
  const gates: EsperaDoAuditor[] = [];
  if (fase === "aprovacao_demanda") {
    gates.push({
      motivo: "gate_demanda",
      ...identificacao,
      ...ticketDaEspera(ticketGlobal("demanda")),
      desde: fase_alterada_em,
    });
  }
  if (fase === "aprovacao_planejamento") {
    gates.push({
      motivo: "gate_planejamento",
      ...identificacao,
      ...ticketDaEspera(ticketGlobal("planejar")),
      desde: fase_alterada_em,
    });
  }
  for (const r of ag.rodadas) {
    if (r.fase !== "aprovacao_pull_request" && r.fase !== "sessao") continue;
    // O gate do PR conta de quando o encerramento da rodada abriu o PR; a sessão de ajustes, de quando ela abriu.
    const etapa = r.fase === "sessao" ? "sessao_em_aberto" : "encerrar_rodada";
    const ticket = ag.tickets.findLast((t) => t.rodada_id === r.rodada_id && t.etapa === etapa);
    const pr = prDaRodada(ag, r.rodada_id);
    gates.push({
      motivo: r.fase === "sessao" ? "ajustes" : "gate_pr",
      ...identificacao,
      rodada: formatarRodadaRef(r),
      ...ticketDaEspera(ticket),
      ...(pr && { pr }),
      desde: ticket?.status_alterado_em ?? fase_alterada_em,
    });
  }
  const falhos = ag.tickets
    .filter((t) => t.status === "falhou")
    .map((t): EsperaDoAuditor => ({
      motivo: "falha",
      ...identificacao,
      ...(t.rodada_id !== undefined && { rodada: formatarRodadaRef({ demanda_id: demanda, rodada_id: t.rodada_id }) }),
      ...ticketDaEspera(t),
      ...(t.motivo_falha !== undefined && { erro: t.motivo_falha }),
      desde: t.status_alterado_em,
    }));
  return [...gates, ...falhos];
}

/** O processo vivo da sessão, que só existe com o pi rodando; os testes o trocam. */
type SituacaoDaSessao = (sessao: string) => Situacao | undefined;

/**
 * A sessão parada no diálogo (com a pergunta, que só o processo vivo tem) ou na conversa. A falha, o gate do
 * planejamento e a conversa da sessão de ajustes já vêm da demanda, sem repetir.
 */
export function esperaDaSessao(s: SessaoDeDemanda, situacaoDa: SituacaoDaSessao): EsperaDoAuditor[] {
  if ((s.motivo !== "dialogo" && s.motivo !== "conversa") || s.etapa === "sessao_em_aberto") return [];
  const pergunta = s.motivo === "dialogo" ? situacaoDa(s.sessao)?.dialogos[0]?.title : undefined;
  return [
    {
      motivo: s.motivo,
      demanda: s.demanda,
      ...(s.rodada && { rodada: s.rodada }),
      projeto: s.projeto,
      titulo: s.titulo,
      ticket: { ref: s.ticket, etapa: s.etapa, modo: s.modo },
      sessao: s.sessao,
      ...(typeof pergunta === "string" && { pergunta }),
      desde: s.desde,
    },
  ];
}

/** `GET /api/inicio`. */
export function inicio(banco: DatabaseSync, situacaoDa: SituacaoDaSessao = situacao): DadosDoInicio {
  const mes = mesDe(new Date());
  // Um mês pedido, um mês devolvido.
  const [doMes] = metricasDemandaPorMes(banco, { de: mes, ate: mes }) as [MetricasMesDemanda];
  const demandas = listarDemandas(banco, { emAndamento: true });
  // Só as sessões das demandas em andamento: calcular o estado de todas as do banco custa segundos.
  const sessoes = demandas.flatMap((ag) => sessoesDeDemanda(banco, { escopo: "ativas", demanda: ag.demanda.id }));
  const modos = new Map(sessoes.map((s) => [s.ticket, s.modo]));
  const modoDe = (ref: string) => modos.get(ref);
  const tituloDoTicket = new Map(
    demandas.flatMap((ag) => ag.tickets.map((t) => [formatarTicketRef(t), t.titulo] as const)),
  );
  return {
    mes: doMes,
    aguarda: [
      ...demandas.flatMap((ag) => esperasDaDemanda(ag, modoDe)),
      ...sessoes.filter((s) => s.estado === "aguardando_humano").flatMap((s) => esperaDaSessao(s, situacaoDa)),
    ].toSorted((a, b) => a.desde.localeCompare(b.desde)),
    rodando: sessoes
      .filter((s) => s.estado === "rodando")
      .map((s) => {
        const fazendo = situacaoDa(s.sessao)?.atividade ?? tituloDoTicket.get(s.ticket);
        return { ...s, ...(fazendo !== undefined && { fazendo }) };
      }),
    emAndamento: demandas.length,
    board: demandas.flatMap((ag) => cartoesDaDemanda(banco, ag, modoDe)),
  };
}

export const ROTAS_DO_INICIO: Rota[] = [
  { metodo: "GET", caminho: "/api/inicio", tratar: ({ banco }) => inicio(banco) },
];

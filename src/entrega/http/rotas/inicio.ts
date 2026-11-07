// Rota do Início (comparacao-sdlc §9.1, "Board com demanda"): numa leitura só, o mês corrente de todos os projetos, o que
// aguarda o Auditor, as sessões que rodam e o board, tudo das demandas em andamento. As concluídas, canceladas e
// arquivadas ficam fora; a navegação conta o que aguarda pela mesma rota.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../../../nucleo/ator.ts";
import type { ModoExecucao } from "../../../nucleo/sessoes.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../../nucleo/agregado_demanda.ts";
import { satisfazDependencia } from "../../../nucleo/cancelamento_demanda.ts";
import { CICLO_DO_TICKET } from "../../../nucleo/ciclos.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../../nucleo/demanda.ts";
import type { EtapaTicket, EstadoDemanda, EstadoRodada, Instante, EstadoTicket } from "../../../nucleo/primitivos.ts";
import { iniciarRevisaoDemanda } from "../../../nucleo/transicoes_demanda.ts";
import { type Situacao, situacao } from "../../../aplicacao/gerente.ts";
import { type SessaoDeDemanda, sessoesDeDemanda } from "../../../aplicacao/historico_demanda.ts";
import { mesDe } from "../../../nucleo/periodo.ts";
import { type MetricasMesDemanda, metricasDemandaPorMes } from "../../../aplicacao/periodo_demanda.ts";
import { listarDemandas } from "../../../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../../../armazenamento/dependencias_demanda.ts";
import { ticketsComPiAtivo } from "../../../armazenamento/sessoes.ts";
import type { Rota } from "../rotas.ts";
import { prDaRodada } from "./demandas.ts";

/**
 * Por que o Auditor é esperado: os três gates, a sessão de ajustes do PR, o ticket falho, a sessão parada nele e a
 * revisão integral que não começou depois da última rodada.
 */
export type MotivoDaEspera =
  "gate_demanda" | "gate_planejamento" | "gate_pr" | "ajustes" | "falha" | "dialogo" | "conversa" | "revisao_parada";

/** Um ticket como o Início o mostra; `modo` é o da sessão ativa dele, quando tem. */
interface TicketDoInicio {
  ref: string;
  etapa: EtapaTicket;
  estado: EstadoTicket;
  modo?: ModoExecucao;
  /** Com execução de pi aberta: o `em_execucao` é o pi, não o sistema. */
  piAtivo?: true;
}

/** O ticket de uma espera: sem o estado, que a espera já diz pelo motivo. */
type TicketDaEspera = Omit<TicketDoInicio, "estado">;

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
  mes: MetricasMesDemanda;
  aguarda: EsperaDoAuditor[];
  rodando: SessaoRodando[];
  /** As demandas em andamento, que o board distribui nos cartões. */
  quantidadeEmAndamento: number;
  board: CartaoDoBoard[];
}

/** O ticket em curso de uma lista e quantos outros ainda não terminaram. */
function ticketEmCurso(
  tickets: readonly TicketDemanda[],
  modoDe: (ref: string) => ModoExecucao | undefined,
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
  modoDe: (ref: string) => ModoExecucao | undefined,
  comPiAtivo: ReadonlySet<string> = new Set(),
): TicketDoInicio {
  const ref = formatarTicketRef(t);
  const modo = modoDe(ref);
  return {
    ref,
    etapa: t.etapa,
    estado: t.estado,
    ...(modo && { modo }),
    ...(comPiAtivo.has(ref) && { piAtivo: true }),
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
  modoDe: (ref: string) => ModoExecucao | undefined,
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

/** O agendador abre a revisão integral a cada minuto; parada além disso, a demanda precisa do Auditor. */
const TOLERANCIA_REVISAO_PARADA_MS = 2 * 60_000;

/**
 * Todas as rodadas concluídas, nada aberto, rodando ou falho, e a revisão integral não abriu na tolerância: a recusa
 * que o agendador só deixa no log do serviço. O motivo é a própria regra aplicada ao agregado em memória.
 */
function esperaDaRevisaoParada(ag: AgregadoDemanda, agora: Date): EsperaDoAuditor[] {
  const { id: demanda, projeto, titulo, estado, estado_alterado_em } = ag.demanda;
  const prontaParaRevisao =
    estado === "em_execucao" &&
    ag.rodadas.length > 0 &&
    ag.rodadas.every((r) => r.estado === "concluida") &&
    !ag.tickets.some((t) => ["aberto", "em_execucao", "falhou"].includes(t.estado));
  if (!prontaParaRevisao) return [];
  // Parada desde o último movimento: a mudança de estado ou o ticket que mudou por último.
  const desde = ag.tickets.reduce(
    (ultimo, t) => (t.estado_alterado_em > ultimo ? t.estado_alterado_em : ultimo),
    estado_alterado_em,
  );
  if (agora.getTime() - Date.parse(desde) < TOLERANCIA_REVISAO_PARADA_MS) return [];
  let erro = "a revisão integral não começou; veja o log do serviço (journalctl --user -u fabriquinha)";
  try {
    iniciarRevisaoDemanda(ag, { demanda_id: demanda }, FABRIQUINHA, { agora: agora.toISOString() });
  } catch (recusa) {
    // A regra só recusa com ErroDeRegra; a entrada aqui é sempre válida.
    erro = `a revisão integral foi recusada: ${(recusa as Error).message}`;
  }
  return [{ motivo: "revisao_parada", demanda, projeto, titulo, erro, desde }];
}

/** Os gates, as sessões de ajustes, os tickets falhos e a revisão integral parada, que esperam o Auditor sem depender da sessão. */
function esperasDaDemanda(
  ag: AgregadoDemanda,
  modoDe: (ref: string) => ModoExecucao | undefined,
  agora: Date,
): EsperaDoAuditor[] {
  const { id: demanda, projeto, titulo, estado, estado_alterado_em } = ag.demanda;
  const identificacao = { demanda, projeto, titulo };
  const ticketGlobal = (etapa: EtapaTicket) =>
    ag.tickets.findLast((t) => t.etapa === etapa && t.rodada_id === undefined);
  const ticketDaEspera = (t: TicketDemanda | undefined) => {
    if (!t) return undefined;
    const { estado: _, ...ticket } = ticketDoInicio(t, modoDe);
    return { ticket };
  };
  const gates: EsperaDoAuditor[] = [];
  if (estado === "gate_demanda") {
    gates.push({
      motivo: "gate_demanda",
      ...identificacao,
      ...ticketDaEspera(ticketGlobal("entender_e_desenhar")),
      desde: estado_alterado_em,
    });
  }
  if (estado === "gate_planejamento") {
    gates.push({
      motivo: "gate_planejamento",
      ...identificacao,
      ...ticketDaEspera(ticketGlobal("planejar")),
      desde: estado_alterado_em,
    });
  }
  for (const r of ag.rodadas) {
    if (r.estado !== "gate_pr" && r.estado !== "ajustar_resultado") continue;
    // O gate do PR conta de quando o encerramento da rodada abriu o PR; a sessão de ajustes, de quando ela abriu.
    const etapa = r.estado === "ajustar_resultado" ? "ajustar_resultado" : "encerrar_rodada";
    const ticket = ag.tickets.findLast((t) => t.rodada_id === r.rodada_id && t.etapa === etapa);
    const pr = prDaRodada(ag, r.rodada_id);
    gates.push({
      motivo: r.estado === "ajustar_resultado" ? "ajustes" : "gate_pr",
      ...identificacao,
      rodada: formatarRodadaRef(r),
      ...ticketDaEspera(ticket),
      ...(pr && { pr }),
      desde: ticket?.estado_alterado_em ?? estado_alterado_em,
    });
  }
  const falhos = ag.tickets
    .filter((t) => t.estado === "falhou")
    .map((t): EsperaDoAuditor => ({
      motivo: "falha",
      ...identificacao,
      ...(t.rodada_id !== undefined && { rodada: formatarRodadaRef({ demanda_id: demanda, rodada_id: t.rodada_id }) }),
      ...ticketDaEspera(t),
      ...(t.motivo_falha !== undefined && { erro: t.motivo_falha }),
      desde: t.estado_alterado_em,
    }));
  return [...gates, ...falhos, ...esperaDaRevisaoParada(ag, agora)];
}

/** O processo vivo da sessão, que só existe com o pi rodando; os testes o trocam. */
type SituacaoDaSessao = (sessao: string) => Situacao | undefined;

/**
 * A sessão parada no diálogo (com a pergunta, que só o processo vivo tem) ou na conversa. A falha, o gate do
 * planejamento e a conversa da sessão de ajustes já vêm da demanda, sem repetir; o diálogo dela, não.
 */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function esperaDaSessao(s: SessaoDeDemanda, situacaoDa: SituacaoDaSessao): EsperaDoAuditor[] {
  if (s.motivo !== "dialogo" && (s.motivo !== "conversa" || s.etapa === "ajustar_resultado")) return [];
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
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function inicio(banco: DatabaseSync, situacaoDa: SituacaoDaSessao = situacao): DadosDoInicio {
  const agora = new Date();
  const mes = mesDe(agora);
  // Um mês pedido, um mês devolvido.
  const [doMes] = metricasDemandaPorMes(banco, { de: mes, ate: mes }) as [MetricasMesDemanda];
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
    aguarda: [
      ...demandas.flatMap((ag) => esperasDaDemanda(ag, modoDe, agora)),
      ...sessoes.filter((s) => s.estado === "aguardando_humano").flatMap((s) => esperaDaSessao(s, situacaoDa)),
    ].toSorted((a, b) => a.desde.localeCompare(b.desde)),
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

export const ROTAS_DO_INICIO: Rota[] = [
  { metodo: "GET", caminho: "/api/inicio", tratar: ({ banco }) => inicio(banco) },
];

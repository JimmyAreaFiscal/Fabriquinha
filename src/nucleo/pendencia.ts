// A Pendência (CONCEITOS.md §11): tudo o que está parado esperando o Auditor. É sempre derivada do estado dos outros
// conceitos, nunca gravada; esta é a única regra que decide o que aguarda o Auditor. Esperar uma Dependência não é Pendência.
import type { AgregadoDemanda, PullRequestDoEspaco } from "./agregado_demanda.ts";
import { Despacho, prontosParaExecutarAgora, situacaoDeUmaDemanda } from "./despacho.ts";
import { Endereco, ticketAtualDaEtapa } from "./item_de_trabalho.ts";
import type { Instante } from "./primitivos.ts";
import { motivoDaFalhaDoTicket, tentativasDoTicket } from "./tentativa.ts";
import { exigirSemPendencias } from "./transicoes_demanda.ts";

/** Por que o Auditor é esperado. */
/** @testes o teste confere o tipo de cada Pendência; a produção o usa pelo `Pendencia` */
export type TipoPendencia =
  "gate_humano" | "item_bloqueado" | "dialogo_do_agente" | "revisao_parada" | "acao_externa" | "despacho_parado";

/** O que o Auditor faz para resolver a Pendência. */
/** @testes o teste confere a ação de cada Pendência; a produção a usa pelo `Pendencia` */
export type AcaoEsperada =
  "decidir_gate" | "reabrir_com_instrucao" | "responder" | "integrar_na_plataforma" | "executar";

/** `motivo` é o texto pronto para exibição; `desde` é quando a espera começou. */
/** @testes o teste confere o valor devolvido por `pendenciasDaDemanda` */
export interface Pendencia {
  tipo: TipoPendencia;
  item: Endereco;
  motivo: string;
  acao_esperada: AcaoEsperada;
  desde: Instante;
}

/**
 * A sessão interativa viva que espera o Auditor: a pergunta do diálogo, quando o processo tem uma, ou a conversa; `desde` é
 * a hora da pergunta (ou da parada, na conversa).
 */
/** @testes o teste monta o trabalho vivo que a produção lê do condutor */
export interface TrabalhoVivo {
  ticket: Endereco;
  pergunta?: string;
  desde: Instante;
}

/** O agendador abre a revisão integral a cada minuto; parada além disso, a demanda precisa do Auditor. */
const TOLERANCIA_REVISAO_PARADA_MS = 2 * 60_000;

/**
 * Todas as rodadas concluídas, nada aberto, rodando ou falho, e a revisão integral não abriu na tolerância: a recusa que
 * o agendador só deixa no log do serviço. O motivo é a regra da revisão aplicada ao agregado em memória, sem abri-la.
 */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function motivoDaRevisaoParada(
  ag: AgregadoDemanda,
  agora: Date,
): { motivo: string; desde: Instante } | undefined {
  const { estado, estado_alterado_em } = ag.demanda;
  const prontaParaRevisao =
    estado === "em_execucao" &&
    ag.rodadas.length > 0 &&
    ag.rodadas.every((r) => r.estado === "concluida") &&
    !ag.tickets.some((t) => ["aberto", "em_execucao", "falhou"].includes(t.estado));
  if (!prontaParaRevisao) return undefined;
  // Parada desde o último movimento: a mudança de estado ou o ticket que mudou por último.
  const desde = ag.tickets.reduce(
    (ultimo, t) => (t.estado_alterado_em > ultimo ? t.estado_alterado_em : ultimo),
    estado_alterado_em,
  );
  if (agora.getTime() - Date.parse(desde) < TOLERANCIA_REVISAO_PARADA_MS) return undefined;
  try {
    exigirSemPendencias(ag);
    return {
      motivo: "A revisão integral não começou; veja o log do serviço (journalctl --user -u fabriquinha)",
      desde,
    };
  } catch (recusa) {
    // A regra só recusa com ErroDeRegra.
    return { motivo: `A revisão integral foi rejeitada: ${(recusa as Error).message}`, desde };
  }
}

/**
 * Tudo o que a demanda tem parado esperando o Auditor, na ordem: gates e sessão de ajustes (estado da demanda, depois das
 * rodadas), merge final, itens bloqueados, diálogos vivos, revisão parada e despachos parados. Quem junta as demandas
 * ordena por `desde`. `predecessorasSatisfeitas` falso é Dependência: o ticket não é elegível e nada é Pendência.
 */
export function pendenciasDaDemanda(
  ag: AgregadoDemanda,
  vivos: readonly TrabalhoVivo[],
  prs: readonly PullRequestDoEspaco[],
  agendadorLigado: boolean,
  { agora = new Date(), predecessorasSatisfeitas = true } = {},
): Pendencia[] {
  const { id: demandaId, estado, estado_alterado_em } = ag.demanda;
  const daDemanda = Endereco.daDemanda(demandaId);
  const vivosDaDemanda = vivos.filter((v) => v.ticket.demanda_id === demandaId);
  const pendencias: Pendencia[] = [];
  if (estado === "gate_demanda") {
    pendencias.push({
      tipo: "gate_humano",
      item: daDemanda,
      motivo: "Aprovação da demanda aguarda decisão",
      acao_esperada: "decidir_gate",
      desde: estado_alterado_em,
    });
  }
  if (estado === "gate_planejamento") {
    pendencias.push({
      tipo: "gate_humano",
      item: daDemanda,
      motivo: "Aprovação do planejamento aguarda decisão",
      acao_esperada: "decidir_gate",
      desde: estado_alterado_em,
    });
  }
  for (const r of ag.rodadas) {
    const item = Endereco.daRodada(demandaId, r.rodada_id);
    if (r.estado === "gate_pr") {
      const pr = prs.find((p) => p.rodada_id === r.rodada_id);
      pendencias.push({
        tipo: "gate_humano",
        item,
        motivo: `${pr ? `PR #${String(pr.numero)}` : "PR"} da rodada aguarda decisão`,
        acao_esperada: "decidir_gate",
        desde: r.estado_alterado_em,
      });
    }
    if (r.estado === "ajustar_resultado") {
      // Com a sessão viva no ticket de ajustes, a pergunta dela (ou a conversa) já é a Pendência.
      const ticketDeAjustes = ticketAtualDaEtapa(ag, "ajustar_resultado", r.rodada_id);
      const jaVivo = vivosDaDemanda.some((v) => v.ticket.ticket_id === ticketDeAjustes?.ticket_id);
      if (!jaVivo) {
        pendencias.push({
          tipo: "dialogo_do_agente",
          item,
          motivo: "A sessão de ajustes do resultado aguarda o Auditor",
          acao_esperada: "responder",
          desde: r.estado_alterado_em,
        });
      }
    }
  }
  const aguardandoMerge = ag.encerramento?.aguardando_merge_humano === true;
  if (aguardandoMerge) {
    const prFinal = prs.find((p) => p.rodada_id === undefined);
    const ticketDoMerge = ticketAtualDaEtapa(ag, "encerrar_demanda");
    pendencias.push({
      tipo: "acao_externa",
      item: daDemanda,
      motivo: `Integrar o PR final${prFinal ? ` #${String(prFinal.numero)}` : ""} na plataforma`,
      acao_esperada: "integrar_na_plataforma",
      desde: ticketDoMerge?.estado_alterado_em ?? estado_alterado_em,
    });
  }
  for (const t of ag.tickets.filter((ticket) => ticket.estado === "falhou")) {
    const motivo = motivoDaFalhaDoTicket(ag.tentativas, t);
    pendencias.push({
      tipo: "item_bloqueado",
      item: Endereco.doTicket(demandaId, t.ticket_id),
      motivo: motivo === undefined ? "Tentativas esgotadas" : `Tentativas esgotadas: ${motivo}`,
      acao_esperada: "reabrir_com_instrucao",
      desde: tentativasDoTicket(ag.tentativas, t.ticket_id).at(-1)?.fim ?? t.estado_alterado_em,
    });
  }
  for (const v of vivosDaDemanda) {
    pendencias.push({
      tipo: "dialogo_do_agente",
      item: v.ticket,
      motivo: v.pergunta === undefined ? "A conversa da sessão aguarda o Auditor" : `O agente pergunta: ${v.pergunta}`,
      acao_esperada: "responder",
      desde: v.desde,
    });
  }
  const parada = motivoDaRevisaoParada(ag, agora);
  if (parada) {
    pendencias.push({
      tipo: "revisao_parada",
      item: daDemanda,
      motivo: parada.motivo,
      acao_esperada: "reabrir_com_instrucao",
      desde: parada.desde,
    });
  }
  if (!agendadorLigado) {
    const selecao = new Despacho().selecionar(situacaoDeUmaDemanda(ag, predecessorasSatisfeitas));
    for (const t of prontosParaExecutarAgora(selecao)) {
      pendencias.push({
        tipo: "despacho_parado",
        item: Endereco.doTicket(demandaId, t.ticket_id),
        motivo: "Ticket aberto e elegível, com o agendador desligado",
        acao_esperada: "executar",
        desde: t.estado_alterado_em,
      });
    }
  }
  return pendencias;
}

// O condutor de trabalhos do serviço: o motor de Sessões (o mecanismo que lança, conversa e encerra o pi) com a política
// do ticket por cima: o que cada falha técnica da execução significa para a Tentativa e, na subida do serviço, os tickets
// que ficaram sem processo.
import type { DatabaseSync } from "node:sqlite";
import {
  AUDITOR,
  type FalhaDaTentativa,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
} from "../../../etapas/publico.ts";
import { relogioDoSistema, type Relogio } from "../../../../../shared/nucleo/relogio.ts";
import {
  type FalhaDaExecucao,
  motorDasSessoes,
  type PedidoDeProcesso,
  type SubidaDasSessoes,
} from "../../../../sessoes/publico.ts";
import { type FalharTicketSemProcesso, falharTicketsPresosNaSubida } from "./processo_do_ticket.ts";

export {
  atividadeDo,
  type Dialogo,
  type EventoDaSessao,
  type PedidoDeProcesso,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type RespostaAutomatica,
  type Situacao,
} from "../../../../sessoes/publico.ts";

/** A falha da Tentativa que cada falha técnica da execução é: o reinício e a infraestrutura se retomam; o resto pede o Auditor. */
function falhaDaTentativaDaExecucao(falha: FalhaDaExecucao): FalhaDaTentativa {
  switch (falha.tipo) {
    case "falha_infraestrutura":
      return falha;
    case "servico_reiniciado":
      return falhaPorServicoReiniciado;
    case "abortada":
      return { tipo: "interrompida", por: AUDITOR, motivo: falha.motivo };
    case "falha_do_agente":
      return falhaQueExigeOAuditor(falha.motivo);
  }
}

/** O que a subida do serviço recupera além dos processos dos tickets, dito por quem é dono de cada coisa. */
export interface RecuperacaoDaSubida {
  falharTicket: FalharTicketSemProcesso;
}

/**
 * O condutor do serviço: todo pi e toda consulta ao modelo passam por ele.
 * ponytail: o motor de Sessões direto, até o passo 6 entregar ao Ciclo de Vida as Sessões montadas.
 */
export const condutor = motorDasSessoes;

/** Lança o pi do processo do ticket (`lancarExecucao`) e resolve com a falha da Tentativa, ou `undefined`. */
export async function iniciarProcessoDoTicket(
  r: PedidoDeProcesso,
  relogio: Relogio = relogioDoSistema,
): Promise<FalhaDaTentativa | undefined> {
  const falha = await condutor.lancarExecucao(r, relogio);
  return falha && falhaDaTentativaDaExecucao(falha);
}

/**
 * F4 §7, do lado dos tickets: o da execução órfã que Sessões encerra na subida falha como "serviço reiniciado", decidido
 * aqui, que sabe quem reiniciou; depois de Sessões, `falharTicketsPresos` falha os que ficaram em execução sem processo.
 */
export function recuperacaoDosTicketsNaSubida(
  banco: DatabaseSync,
  { falharTicket }: RecuperacaoDaSubida,
  relogio: Relogio = relogioDoSistema,
): SubidaDasSessoes & { falharTicketsPresos(): void } {
  return {
    aoEncerrarExecucaoOrfa: (ref) => {
      falharTicket(banco, ref, falhaPorServicoReiniciado, relogio);
    },
    falharTicketsPresos: () => {
      falharTicketsPresosNaSubida(banco, falharTicket, relogio);
    },
  };
}

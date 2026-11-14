// A política do ticket sobre as execuções que Sessões conduz: o que cada falha técnica da execução significa para a
// Tentativa e, na subida do serviço, os tickets que ficaram sem processo.
import type { DatabaseSync } from "node:sqlite";
import {
  AUDITOR,
  type FalhaDaTentativa,
  falhaDoErro,
  falhaInterrompidaPeloAuditor,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
} from "../../../etapas/publico.ts";
import { relogioDoSistema, type Relogio } from "../../../../../shared/nucleo/relogio.ts";
import type { FalhaDaExecucao, SubidaDasSessoes } from "../../../../sessoes/publico.ts";
import { type FalharTicketSemProcesso, falharTicketsPresosNaSubida } from "./processo_do_ticket.ts";

/**
 * A falha da Tentativa que cada falha técnica da execução é: o reinício e a infraestrutura se retomam; a interrupção e o
 * aborto são do Auditor; o erro da preparação é classificado como o de qualquer etapa; o resto pede o Auditor.
 */
export function falhaDaTentativaDaExecucao(falha: FalhaDaExecucao): FalhaDaTentativa {
  switch (falha.tipo) {
    case "falha_infraestrutura":
      return falha;
    case "servico_reiniciado":
      return falhaPorServicoReiniciado;
    case "interrompida":
      return falhaInterrompidaPeloAuditor;
    case "abortada":
      return { tipo: "interrompida", por: AUDITOR, motivo: falha.motivo };
    case "preparacao_falhou":
      return falhaDoErro(falha.erro);
    case "falha_do_agente":
      return falhaQueExigeOAuditor(falha.motivo);
  }
}

/** O que a subida do serviço recupera além dos processos dos tickets, dito por quem é dono de cada coisa. */
export interface RecuperacaoDaSubida {
  falharTicket: FalharTicketSemProcesso;
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

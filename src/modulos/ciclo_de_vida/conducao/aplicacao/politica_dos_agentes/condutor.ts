// O condutor de trabalhos do serviço: as `SessoesDeAgente` de Sessões (o mecanismo que lança, conversa e encerra o pi)
// com a política do ticket por cima: o que cada falha técnica da execução significa para a Tentativa e, na subida do
// serviço, o ticket que ficou sem processo. Herda o mecanismo em vez de compô-lo: o servidor e o Processo chamam o mecanismo
// pelo condutor, e a composição obrigaria a repassar cada método a cada chamador.
import type { DatabaseSync } from "node:sqlite";
import {
  AUDITOR,
  type FalhaDaTentativa,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
} from "../../../etapas/publico.ts";
import { relogioDoSistema, type Relogio } from "../../../../../shared/nucleo/relogio.ts";
import { type FalhaDaExecucao, type PedidoDeProcesso, SessoesDeAgente } from "../../../../sessoes/publico.ts";
import { type FalharTicketSemProcesso, recuperarProcessosAbertos } from "./processo_do_ticket.ts";

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

export class CondutorDeTrabalhos extends SessoesDeAgente {
  /** Lança o pi do processo do ticket (`lancarExecucao`) e resolve com a falha da Tentativa, ou `undefined`. */
  async iniciar(r: PedidoDeProcesso, relogio: Relogio = relogioDoSistema): Promise<FalhaDaTentativa | undefined> {
    const falha = await this.lancarExecucao(r, relogio);
    return falha && falhaDaTentativaDaExecucao(falha);
  }

  /**
   * F4 §7: todo processo em andamento é de uma instância anterior. Mata o grupo do pi de cada um (Sessões); os processos
   * dos tickets se encerram com "serviço reiniciado", decidido aqui, que sabe quem reiniciou, e o motor falha o ticket
   * deles (`falharTicket`).
   */
  async recuperarNaSubida(banco: DatabaseSync, { falharTicket }: RecuperacaoDaSubida): Promise<void> {
    await this.matarProcessosDaInstanciaAnterior(banco);
    recuperarProcessosAbertos(banco, this.avisar, this.harness, falharTicket);
  }
}

/** O condutor do serviço: todo pi e toda consulta ao modelo passam por ele; o harness vem da composição. */
export const condutor = new CondutorDeTrabalhos();

// O Gate da revisão da demanda, dono do `revisar_demanda`: o agente revisor aprova a demanda inteira ou abre rodadas corretivas.
import type { AgregadoDemanda, TicketDemanda } from "../../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import type { Decisao } from "../../../processo/publico.ts";
import { FABRIQUINHA, type Endereco, DEFINICAO_DO_REVISAR_DEMANDA } from "../../../etapas/publico.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET, type EntradaReprovada } from "../../../processo/publico.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { ancoraNaDemanda, Gate } from "../../../../sdlc/nucleo/gate.ts";
import { criarTicket, correcaoDasRodadasNovas } from "../../../planejamento/publico.ts";
import { materializar } from "../../../../sdlc/nucleo/demanda/plano.ts";
import { exigirSemPendencias, mudarTicket } from "../../../../sdlc/nucleo/transicoes/transicoes_demanda.ts";

/**
 * CA-13 e CA-14: só o agente do `revisar_demanda` atual. Reprovada, as exigências vão em `motivo` e o plano corretivo
 * cria só rodadas novas (as integradas ficam como estão) e a demanda volta a `em_execucao`; aceita, abre
 * `encerrar_demanda` e vai a `encerrar_demanda`.
 */
export class GateDaRevisaoDaDemanda extends Gate {
  constructor() {
    super(DEFINICAO_DO_REVISAR_DEMANDA);
  }

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    const ticket = ancoraNaDemanda(ag, endereco, "revisar_demanda", this.etapaAncora);
    if (!CICLO_DO_TICKET.estaEmAndamento(ticket.estado)) {
      throw new ErroDeRegra(
        `o ticket ${String(ticket.ticket_id)} está ${ticket.estado}`,
        "só ticket aberto ou em execução age",
      );
    }
    exigirSemPendencias(ag, ticket.ticket_id);
    return ticket;
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    return {
      ...concluido,
      demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "encerrar_demanda", decisao.em),
      tickets: [
        ...concluido.tickets,
        criarTicket(ag, { etapa: "encerrar_demanda", criado_por: FABRIQUINHA, agora: decisao.em }),
      ],
    };
  }

  protected aoReprovar(
    ag: AgregadoDemanda,
    ticket: TicketDemanda,
    decisao: Decisao,
    { correcoes }: EntradaReprovada,
  ): AgregadoDemanda {
    // Plano corretivo vazio ou inválido recusa aqui, antes de qualquer retorno.
    const base = materializar(ag, correcaoDasRodadasNovas(decisao.por, correcoes), { agora: decisao.em });
    return {
      ...mudarTicket(base, ticket, "concluido", decisao.em),
      demanda: CICLO_DA_DEMANDA.mudar(base.demanda, "em_execucao", decisao.em),
    };
  }
}

// O Gate do planejamento, dono do `planejar`: o Auditor aprova o Plano proposto ou o devolve ao agente.
import type { AgregadoDemanda, TicketDemanda } from "../../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import type { Decisao } from "../../../processo/publico.ts";
import { AUDITOR, DEFINICAO_DO_PLANEJAR } from "../../../etapas/publico.ts";
import { CICLO_DA_DEMANDA, type EntradaReprovada } from "../../../processo/publico.ts";
import { ancoraNaDemanda, Gate } from "../../../../sdlc/nucleo/gate.ts";
import type { Endereco } from "../../../etapas/publico.ts";
import {
  exigirSemFalha,
  materializarPlano,
  planoSubmetido,
  reabrirTicket,
  tentativasAposSair,
} from "../../../../sdlc/nucleo/transicoes/transicoes_demanda.ts";

/** CA-4 a CA-7: o Auditor reprova (volta a `planejar` com o mesmo ticket) ou aprova (materializa o Plano e vai a `em_execucao`). */
export class GateDoPlanejamento extends Gate {
  constructor() {
    super(DEFINICAO_DO_PLANEJAR);
  }

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    const ticket = ancoraNaDemanda(ag, endereco, "gate_planejamento", this.etapaAncora);
    planoSubmetido(ag, ticket); // recusa se não há plano submetido
    return ticket;
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    exigirSemFalha(ag, this.etapaAncora);
    return materializarPlano(ag, ticket, decisao.em);
  }

  protected aoReprovar(
    ag: AgregadoDemanda,
    ticket: TicketDemanda,
    decisao: Decisao,
    { motivo }: EntradaReprovada,
  ): AgregadoDemanda {
    const reprovada = {
      ...ag,
      demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "planejar", decisao.em),
      tentativas: tentativasAposSair(ag, ticket, { tipo: "interrompida", por: AUDITOR, motivo }, decisao.em),
    };
    // Planejar falhou (serviço reiniciado com o gate aberto): a reprovação o reabre com o motivo.
    return ticket.estado === "falhou"
      ? reabrirTicket(reprovada, { ticket_id: ticket.ticket_id, instrucao: motivo }, AUDITOR, { agora: decisao.em })
      : reprovada;
  }
}

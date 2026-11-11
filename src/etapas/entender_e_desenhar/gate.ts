// O Gate da demanda, dono do `entender_e_desenhar`: o Auditor aprova a demanda enviada ou a cancela.
import type { AgregadoDemanda, Decisao, TicketDemanda } from "../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { FABRIQUINHA } from "../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { CICLO_DA_DEMANDA } from "../../sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import { ancoraNaDemanda, Gate } from "../../sdlc/nucleo/gate.ts";
import { criarTicket } from "../../sdlc/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { type Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { exigirSemFalha, mudarTicket } from "../../sdlc/nucleo/transicoes/transicoes_demanda.ts";
import { DEFINICAO_DO_ENTENDER_E_DESENHAR } from "./definicao.ts";

/** CA-4 e CA-5: o Auditor aprova (vai a `planejar`) ou reprova com motivo (vai a `cancelada`, sem desenho interno). */
export class GateDaDemanda extends Gate {
  constructor() {
    super(DEFINICAO_DO_ENTENDER_E_DESENHAR);
  }

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    const ticket = ancoraNaDemanda(ag, endereco, "gate_demanda", this.etapaAncora);
    exigirSemFalha(ag, this.etapaAncora);
    return ticket;
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    // Aprovar libera o planejamento: sem o ticket `planejar` aberto a seleção não tem o que despachar.
    const abrirPlanejar = !ag.tickets.some((t) => t.etapa === "planejar");
    return {
      ...concluido,
      demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "planejar", decisao.em),
      tickets: abrirPlanejar
        ? [...concluido.tickets, criarTicket(ag, { etapa: "planejar", criado_por: FABRIQUINHA, agora: decisao.em })]
        : concluido.tickets,
    };
  }

  protected aoReprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    return {
      ...mudarTicket(ag, ticket, "cancelado", decisao.em),
      demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "cancelada", decisao.em),
    };
  }
}

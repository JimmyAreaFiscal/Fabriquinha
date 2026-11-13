// O Gate do PR da rodada, dono do `encerrar_rodada`: o Auditor (ou a aprovação automática) decide o PR publicado.
import type { AgregadoDemanda, TicketDemanda } from "../../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import type { Decisao } from "../../../processo/publico.ts";
import {
  type Ator,
  exigirAtor,
  FABRIQUINHA,
  type Endereco,
  DEFINICAO_DO_ENCERRAR_RODADA,
} from "../../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { ancoraNaRodada, Gate } from "../../../../sdlc/nucleo/gate.ts";
import { type EntradaDoGate } from "../../../processo/publico.ts";
import { criarTicket } from "../../../planejamento/publico.ts";
import { mudarTicket } from "../../../../sdlc/nucleo/transicoes/transicoes_demanda.ts";
import { rodadasComEstadoMudado } from "../../../../sdlc/nucleo/transicoes/transicoes_rodada.ts";

/**
 * CA-6 e CA-7: o Auditor aprova com nota (a rodada vai a `concluida`) ou reprova com motivo (abre `ajustar_resultado`).
 * A Fabriquinha também aprova, sem nota, no projeto que ligou a aprovação automática.
 */
export class GateDoPR extends Gate {
  constructor() {
    super(DEFINICAO_DO_ENCERRAR_RODADA);
  }

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    return ancoraNaRodada(ag, endereco, "gate_pr", this.etapaAncora);
  }

  protected override exigirDecisor(ator: Ator): void {
    exigirAtor(ator, "decidir o gate_pr", "auditor", "fabriquinha");
  }

  override validarEntrada(entrada: unknown, ator: Ator): EntradaDoGate {
    const e = super.validarEntrada(entrada, ator);
    if (ator.tipo === "fabriquinha" && (e.resultado === "reprovado" || e.nota !== undefined)) {
      throw new ErroDeRegra("a Fabriquinha só aprova o PR, e sem nota", "a nota é do Auditor");
    }
    if (ator.tipo === "auditor" && e.resultado === "aprovado" && e.nota === undefined) {
      throw new ErroDeRegra("aprovar o PR exige a nota", "informe a nota de 1 a 5");
    }
    if (e.resultado === "reprovado" && e.nota !== undefined) {
      throw new ErroDeRegra("a reprovação do PR não leva nota", "omita a nota");
    }
    return e;
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    return { ...concluido, rodadas: rodadasComEstadoMudado(concluido, ticket, "concluida", decisao.em) };
  }

  protected aoReprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    return {
      ...concluido,
      tickets: [
        ...concluido.tickets,
        criarTicket(ag, {
          etapa: "ajustar_resultado",
          rodada: ticket.rodada_id,
          criado_por: FABRIQUINHA,
          agora: decisao.em,
        }),
      ],
      rodadas: rodadasComEstadoMudado(concluido, ticket, "ajustar_resultado", decisao.em),
    };
  }
}

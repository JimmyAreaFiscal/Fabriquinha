// A condução do `planejar` (comparacao-sdlc-implementacao.md §§3 e 6): sessão interativa em que o plano chega pelo CLI e
// o gate do planejamento decide. A falha do pi não falha o ticket: ele segue em execução à espera de uma nova sessão.
import type { TicketDemanda } from "../../../../demanda/nucleo/agregado_demanda.ts";
import { CICLO_DA_DEMANDA } from "../../../nucleo/ciclo_de_vida/ciclos.ts";
import { predecessorasPendentes } from "../../../../demanda/nucleo/item_de_trabalho/dependencia_demanda.ts";
import { ErroDeRegra, existe } from "../../../../compartilhado/nucleo/erros.ts";
import { CATALOGO_DE_ETAPAS } from "../../../nucleo/etapa.ts";
import { Endereco } from "../../../../demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { FABRIQUINHA } from "../../../nucleo/ator.ts";
import { reservarTicket } from "../../../../execucao/nucleo/reserva_ticket.ts";
import { montarRetornoAoAgente, tentativaAnteriorEmMemoria } from "../../../../execucao/nucleo/tentativa.ts";
import { carregarDemanda, comDemanda } from "../../../../demanda/armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../../../../demanda/armazenamento/dependencias_demanda.ts";
import { carregarTrabalhosDoTicket } from "../../../../execucao/armazenamento/trabalho_agentico.ts";
import type { OpcoesExecucaoDemanda } from "../../../../execucao/aplicacao/execucao_demanda.ts";
import { ConducaoInterativa, type DepsDaConducao } from "../agenticas/conducao_de_etapa.ts";

export class ConducaoDePlanejar extends ConducaoInterativa {
  constructor(deps: DepsDaConducao) {
    super(CATALOGO_DE_ETAPAS.planejar, deps);
  }

  /** Reserva o `planejar` aberto (só com as predecessoras satisfeitas); com o ticket já em execução, retoma a mesma sessão. */
  protected override reservar(ticket: TicketDemanda): void {
    const { banco, relogio } = this.deps;
    CICLO_DA_DEMANDA.exigir(carregarDemanda(banco, ticket.demanda_id).demanda, "planejar");
    if (ticket.estado === "aberto") {
      const satisfeitas = predecessorasPendentes(predecessorasDaDemanda(banco, ticket.demanda_id)).length === 0;
      comDemanda(banco, ticket.demanda_id, (ag) =>
        reservarTicket(ag, { ticket_id: ticket.ticket_id }, FABRIQUINHA, { agora: relogio.agora() }, satisfeitas),
      );
    } else if (ticket.estado !== "em_execucao") {
      throw new ErroDeRegra(
        `o ticket de planejamento da demanda ${ticket.demanda_id} está ${ticket.estado} e não pode ser iniciado`,
        "só se inicia ou retoma o planejamento com o ticket aberto ou em execução",
      );
    }
  }

  /**
   * A reprovação é o último fato da conversa: o motivo dela vem antes da instrução, que pode ser de uma reabertura
   * anterior (ou a cópia do próprio motivo, quando a reprovação reabriu o ticket falho). Plano aprovado e depois
   * descartado: a conversa que o produziu não volta, senão o agente reenvia o mesmo plano; o replanejamento começa em
   * sessão nova e, já começado (execução depois da aprovação), é ele que se retoma.
   */
  protected override retomadaDe(
    ticket: TicketDemanda,
  ): Pick<OpcoesExecucaoDemanda, "retomada" | "iniciarEmSessaoNova"> {
    const ultima = carregarDemanda(this.deps.banco, ticket.demanda_id)
      .decisoes.filter((d) => d.ticket_id === ticket.ticket_id)
      .at(-1);
    if (ultima?.resultado === "reprovado") {
      return {
        retomada: montarRetornoAoAgente(
          tentativaAnteriorEmMemoria(Endereco.doTicket(ticket.demanda_id, ticket.ticket_id), {
            motivoDaReprovacao: existe(ultima.motivo, "a reprovação não tem motivo", "confira o banco"),
          }),
        ),
      };
    }
    return {
      ...super.retomadaDe(ticket),
      iniciarEmSessaoNova:
        ultima?.resultado === "aprovado" &&
        !carregarTrabalhosDoTicket(this.deps.banco, ticket).execucoes.some((e) => e.inicio >= ultima.em),
    };
  }

  // A Decisão do gate do planejamento é quem conclui o ticket.
  protected override aoConcluir(): Promise<void> {
    return Promise.resolve();
  }

  // O pi que falha ou é interrompido não decide nada: o ticket segue em execução e o despacho retoma a sessão.
  protected override falhar(): Promise<void> {
    return Promise.resolve();
  }
}

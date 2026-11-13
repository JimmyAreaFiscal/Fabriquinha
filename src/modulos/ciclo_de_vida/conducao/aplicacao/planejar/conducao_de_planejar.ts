// A condução do `planejar` (comparacao-sdlc-implementacao.md §§3 e 6): sessão interativa em que o plano chega pelo CLI e
// o gate do planejamento decide. A falha do pi não falha o ticket: ele segue em execução à espera de uma nova sessão.
import { carregarSessoesDoContexto } from "../../../../sessoes/publico.ts";
import type { TicketDemanda } from "../../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { CICLO_DA_DEMANDA, montarRetornoAoAgente, tentativaAnteriorEmMemoria } from "../../../processo/publico.ts";
import { ErroDeRegra, existe } from "../../../../../shared/nucleo/erros.ts";
import { secaoDoPromptDoPlanejar } from "./secao_do_prompt.ts";
import { DEFINICAO_DO_PLANEJAR, Endereco } from "../../../etapas/publico.ts";
import { carregarDemanda } from "../../../../sdlc/armazenamento/demandas.ts";
import type { OpcoesExecucaoDemanda } from "../execucao/execucao_demanda.ts";
import { ConducaoInterativa } from "../conducao_de_etapa/conducao_de_etapa.ts";
import type { DepsDaConducao } from "../conducao_de_etapa/conducao_de_etapa.ts";

export class ConducaoDePlanejar extends ConducaoInterativa {
  protected override readonly secaoDoPrompt = secaoDoPromptDoPlanejar;

  constructor(deps: DepsDaConducao) {
    super(DEFINICAO_DO_PLANEJAR, deps);
  }

  /** Só o `planejar` em execução, que o Despacho reservou ou que retoma a mesma sessão, com a demanda em planejamento. */
  override iniciar(endereco: Endereco): ReturnType<ConducaoInterativa["iniciar"]> {
    const ticket = this.ticketDe(endereco);
    CICLO_DA_DEMANDA.exigir(carregarDemanda(this.deps.banco, ticket.demanda_id).demanda, "planejar");
    if (ticket.estado !== "em_execucao") {
      throw new ErroDeRegra(
        `o ticket de planejamento da demanda ${ticket.demanda_id} está ${ticket.estado} e não pode ser iniciado`,
        "só se inicia ou retoma o planejamento com o ticket aberto ou em execução",
      );
    }
    return super.iniciar(endereco);
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
        !carregarSessoesDoContexto(this.deps.banco, ticket).execucoes.some((e) => e.inicio >= ultima.em),
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

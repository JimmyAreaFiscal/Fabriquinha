// A condução do `ajustar_resultado` (comparacao-sdlc-implementacao.md §§4 e 6): o `GateDoPR` reprovado abre a conversa do
// Auditor com o agente, que só registra tickets corretivos. O ticket nunca sai de `aberto`: o Auditor o conclui com a
// sessão, e o fim de cada execução devolve as branches da rodada e da demanda aos SHAs gravados ao abrir.
import {
  carregarDemanda,
  montarRetornoAoAgente,
  tentativaAnteriorEmMemoria,
  type TicketDemanda,
} from "../../../processo/publico.ts";
import {
  formatarRodadaRef,
  formatarTicketRef,
  DEFINICAO_DO_AJUSTAR_RESULTADO,
  Endereco,
} from "../../../etapas/publico.ts";
import { existe } from "../../../../../shared/nucleo/erros.ts";
import type { OpcoesExecucaoDemanda } from "../execucao/execucao_demanda.ts";
import { espacoComPrPublicado, restaurar } from "./sessao_ajustes.ts";
import { ConducaoInterativa, type DepsDaConducao } from "../conducao_de_etapa/conducao_de_etapa.ts";

export class ConducaoDeAjustarResultado extends ConducaoInterativa {
  constructor(deps: DepsDaConducao) {
    super(DEFINICAO_DO_AJUSTAR_RESULTADO, deps);
  }

  /** Leva ao agente o PR reprovado e o motivo do Auditor, a última recusa de um `encerrar_rodada` da rodada. */
  protected override retomadaDe(ticket: TicketDemanda): Pick<OpcoesExecucaoDemanda, "retomada"> {
    const ref = this.rodadaDe(ticket);
    const ag = carregarDemanda(this.deps.banco, ticket.demanda_id);
    const encerramentos = new Set(
      ag.tickets.filter((t) => t.rodada_id === ref.rodada_id && t.etapa === "encerrar_rodada").map((t) => t.ticket_id),
    );
    const reprovacao = ag.decisoes.filter((d) => d.resultado === "reprovado" && encerramentos.has(d.ticket_id)).at(-1);
    const motivo = existe(reprovacao?.motivo, "o PR da rodada não foi reprovado", "só a rodada reprovada tem ajustes");
    const { pr } = espacoComPrPublicado(this.deps.banco, ag, ref);
    return {
      retomada: montarRetornoAoAgente(
        tentativaAnteriorEmMemoria(Endereco.doTicket(ticket.demanda_id, ticket.ticket_id), {
          instrucao:
            `Esta é a sessão de ajustes da rodada ${formatarRodadaRef(ref)} (ticket ${formatarTicketRef(ticket)}): ` +
            `converse e registre tickets corretivos, sem implementar nem integrar.\n` +
            `O Auditor reprovou o PR ${pr.url} da rodada. Motivo: ${motivo}`,
        }),
      ),
    };
  }

  // O fim da execução não conclui a sessão: devolve as branches ao marco.
  protected override aoConcluir(endereco: Endereco): Promise<void> {
    return restaurar(this.deps.banco, this.rodadaDe(this.ticketDe(endereco)));
  }

  // A execução que falha ou é interrompida também devolve as branches; o ticket segue aberto para o Auditor.
  protected override falhar(ticket: TicketDemanda): Promise<void> {
    return restaurar(this.deps.banco, this.rodadaDe(ticket));
  }

  private rodadaDe(ticket: TicketDemanda) {
    const rodada_id = existe(
      ticket.rodada_id,
      `o ticket ${formatarTicketRef(ticket)} não é de rodada`,
      "confira o banco",
    );
    return { demanda_id: ticket.demanda_id, rodada_id };
  }
}

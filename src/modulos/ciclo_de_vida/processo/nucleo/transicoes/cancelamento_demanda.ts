// Cancelar e arquivar a demanda SDLC (comparacao-sdlc-implementacao.md §3, decisão D08 do Auditor).
// Funções puras no estilo de transicoes_demanda.ts; interromper a execução e cascatear às dependentes é da aplicação.
import { type Ator, exigirAtor } from "../../../etapas/publico.ts";
import { AgregadoDemanda } from "../agregado/agregado_demanda.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET } from "../ciclos/ciclos.ts";
import { type ContextoDemanda, mudarTicket } from "./transicoes_demanda.ts";

/** CA-1 a CA-7: só o Auditor, antes da integração confirmada; aberto, falhou e em_execucao viram cancelado. */
export function cancelarDemanda(ag: AgregadoDemanda, ator: Ator, ctx: ContextoDemanda): AgregadoDemanda {
  exigirAtor(ator, "cancelar a demanda", "auditor");
  const { demanda } = ag;
  if (CICLO_DA_DEMANDA.ehTerminal(demanda.estado)) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já terminou (${demanda.estado})`,
      "só demanda em andamento é cancelada",
    );
  }
  if (ag.encerramento?.integracao !== undefined) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já tem a integração confirmada na base`,
      "o código já está na base; não há o que cancelar",
    );
  }
  const ticketsCancelados = ag.tickets
    .filter((t) => !CICLO_DO_TICKET.ehTerminal(t.estado))
    .reduce((acumulado, t) => mudarTicket(acumulado, t, "cancelado", ctx.agora), ag);
  return AgregadoDemanda.parse({
    ...ticketsCancelados,
    demanda: CICLO_DA_DEMANDA.mudar(demanda, "cancelada", ctx.agora),
  });
}

/** CA-8 a CA-10: só o Auditor, só em `concluida`; muda apenas o estado. */
export function arquivarDemanda(ag: AgregadoDemanda, ator: Ator, ctx: ContextoDemanda): AgregadoDemanda {
  exigirAtor(ator, "arquivar a demanda", "auditor");
  CICLO_DA_DEMANDA.exigir(ag.demanda, "concluida");
  return AgregadoDemanda.parse({
    ...ag,
    demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "arquivada", ctx.agora),
  });
}

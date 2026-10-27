// Cancelar e arquivar a demanda SDLC (comparacao-sdlc-implementacao.md §3, decisão D08 do Auditor).
// Funções puras no estilo de transicoes_demanda.ts; interromper a execução e cascatear às dependentes é da aplicação.
import { type Ator, exigirAuditor } from "./agregado.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import type { FaseDemanda } from "./primitivos.ts";
import { type ContextoDemanda, exigirFase } from "./transicoes_demanda.ts";

const FASES_TERMINADAS: readonly FaseDemanda[] = ["concluida", "arquivada", "cancelada"];

/** CA-1 a CA-7: só o Auditor, antes da integração confirmada; aberto/falhou viram fechado e em_execucao vira cancelado. */
export function cancelarDemanda(ag: AgregadoDemanda, ator: Ator, ctx: ContextoDemanda): AgregadoDemanda {
  exigirAuditor(ator, "cancelar a demanda");
  const { demanda } = ag;
  if (FASES_TERMINADAS.includes(demanda.fase)) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já terminou (${demanda.fase})`,
      "só demanda em andamento é cancelada",
    );
  }
  if (ag.encerramento?.integracao !== undefined) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já tem a integração confirmada na base`,
      "o código já está na base; não há o que cancelar",
    );
  }
  return AgregadoDemanda.parse({
    ...ag,
    demanda: { ...demanda, fase: "cancelada", fase_alterada_em: ctx.agora },
    tickets: ag.tickets.map((t) => {
      if (t.status === "aberto" || t.status === "falhou")
        return { ...t, status: "fechado", status_alterado_em: ctx.agora };
      if (t.status === "em_execucao") return { ...t, status: "cancelado", status_alterado_em: ctx.agora };
      return t;
    }),
  });
}

/** CA-8 a CA-10: só o Auditor, só em `concluida`; muda apenas a fase. */
export function arquivarDemanda(ag: AgregadoDemanda, ator: Ator, ctx: ContextoDemanda): AgregadoDemanda {
  exigirAuditor(ator, "arquivar a demanda");
  exigirFase(ag, "concluida", "ser arquivada: só demanda concluída pode ser arquivada");
  return AgregadoDemanda.parse({ ...ag, demanda: { ...ag.demanda, fase: "arquivada", fase_alterada_em: ctx.agora } });
}

/** CA-11 e CA-12: `arquivada` tem os mesmos efeitos de `concluida` para quem depende da demanda. */
export const satisfazDependencia = (fase: FaseDemanda): boolean => fase === "concluida" || fase === "arquivada";

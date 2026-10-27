// Revisão integral da demanda (comparacao-sdlc-implementacao.md §§3, 4, 8): inicia, conduz na worktree da demanda e decide.
import type { DatabaseSync } from "node:sqlite";
import { type Ator, FABRIQUINHA } from "../dominio/agregado.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { encontrado } from "../dominio/erros.ts";
import { iniciarRevisaoDemanda, registrarRevisaoDemanda } from "../dominio/transicoes_demanda.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { conduzirRevisao, type OpcoesRevisao, type ResultadoRevisao } from "./revisao_conducao.ts";
import { conferirAprovacao } from "./revisao_pendencias.ts";

/** Todas as rodadas concluídas: a demanda vai a `revisao_demanda` com o `revisar_demanda` aberto. */
export function iniciarRevisaoIntegral(banco: DatabaseSync, demanda_id: string): AgregadoDemanda {
  return comDemanda(banco, demanda_id, (ag) =>
    iniciarRevisaoDemanda(ag, { demanda_id }, FABRIQUINHA, { agora: new Date().toISOString() }),
  );
}

/** Reserva e executa o `revisar_demanda` atual; o ticket é global, então o pi roda na worktree da demanda. */
export async function conduzirRevisaoIntegral(
  banco: DatabaseSync,
  demanda_id: string,
  opcoes: Omit<OpcoesRevisao, "preparar">,
): Promise<ResultadoRevisao> {
  const { ticket_id } = encontrado(
    carregarDemanda(banco, demanda_id).tickets.findLast((t) => t.etapa === "revisar_demanda"), // o atual é o de maior ticket_id
    `a demanda ${demanda_id} não tem ticket revisar_demanda`,
    "inicie a revisão integral da demanda antes de conduzi-la",
  );
  return conduzirRevisao(banco, { demanda_id, ticket_id }, opcoes);
}

/** Aplica a decisão do agente; a aprovação só passa com as evidências, o estresse e a segurança em ordem. */
export function decidirRevisaoIntegral(
  banco: DatabaseSync,
  entrada: { aprovado: boolean; demanda_id: string; ticket_id: number; [campo: string]: unknown },
  ator: Ator,
): AgregadoDemanda {
  return comDemanda(banco, entrada.demanda_id, (ag) => {
    const novo = registrarRevisaoDemanda(ag, entrada, ator, { agora: new Date().toISOString() });
    if (entrada.aprovado) conferirAprovacao(ag, entrada.ticket_id);
    return novo;
  });
}

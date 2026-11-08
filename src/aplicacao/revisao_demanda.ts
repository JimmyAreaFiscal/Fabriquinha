// Revisão integral da demanda (comparacao-sdlc-implementacao.md §§3, 4, 8): inicia, conduz na worktree da demanda e decide.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { encontrado } from "../nucleo/erros.ts";
import { ticketAtualDaEtapa } from "../nucleo/item_de_trabalho.ts";
import { iniciarRevisaoDemanda } from "../nucleo/transicoes_demanda.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { conduzirRevisao, type OpcoesRevisao, type ResultadoRevisao } from "./revisao_conducao.ts";

/** Todas as rodadas concluídas: a demanda vai a `revisar_demanda` com o `revisar_demanda` aberto. */
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
    ticketAtualDaEtapa(carregarDemanda(banco, demanda_id), "revisar_demanda"),
    `a demanda ${demanda_id} não tem ticket revisar_demanda`,
    "inicie a revisão integral da demanda antes de conduzi-la",
  );
  return conduzirRevisao(banco, { demanda_id, ticket_id }, opcoes);
}

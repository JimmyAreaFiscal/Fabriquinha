// As predecessoras de cada demanda com o estado do desenvolvimento delas, e a regra única de bloqueio: a demanda é
// bloqueada pelas predecessoras que ainda não satisfazem a Dependência (concluída e arquivada satisfazem, D08). As
// arestas vêm das Dependências de Demandas, e o estado, do Ciclo de Vida, cada um numa leitura em lote. O board, o
// Início, a página da demanda, a do projeto e o chat mostram as mesmas.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../shared/nucleo/erros.ts";
import { andamentoDasDemandasEmLote, CICLO_DA_DEMANDA, EstadoDemanda } from "../../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../../modulos/demandas/publico.ts";

export interface Predecessora {
  demanda_id: string;
  estado: EstadoDemanda;
}

/** As predecessoras diretas de cada demanda de `ids`, na ordem em que a dependência foi registrada, com o estado de cada uma. */
export function predecessorasDasDemandas(
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  ids: readonly string[],
): Map<string, Predecessora[]> {
  const predecessorasDoPedido = new Map(ids.map((id): [string, readonly string[]] => [id, []]));
  for (const pedido of gestaoDeDemandas.pedidos({ ids })) predecessorasDoPedido.set(pedido.id, pedido.predecessoras);
  const andamentos = andamentoDasDemandasEmLote(banco, [...new Set([...predecessorasDoPedido.values()].flat())]);
  const comEstado = (demanda_id: string): Predecessora => ({
    demanda_id,
    estado: EstadoDemanda.parse(
      encontrado(andamentos.get(demanda_id), `a demanda ${demanda_id} não foi lida`, "recarregue").estado,
    ),
  });
  return new Map([...predecessorasDoPedido].map(([id, predecessoras]) => [id, predecessoras.map(comEstado)]));
}

/** As predecessoras da demanda `id`, lidas em lote com as das outras. */
export const predecessorasDe = (predecessoras: ReadonlyMap<string, Predecessora[]>, id: string): Predecessora[] =>
  encontrado(predecessoras.get(id), `a demanda ${id} não foi lida`, "recarregue");

/** As predecessoras que bloqueiam a demanda, na ordem recebida. */
export const bloqueiosDaDemanda = (predecessoras: readonly Predecessora[]): Predecessora[] =>
  predecessoras.filter((p) => !CICLO_DA_DEMANDA.satisfazDependencia(p.estado));

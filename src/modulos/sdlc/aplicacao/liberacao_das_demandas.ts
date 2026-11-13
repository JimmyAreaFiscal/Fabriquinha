// As predecessoras pendentes das demandas, que quem chama o Despacho lhe informa (MELHORIAS §11, regra 4): as arestas e
// o estado do processo das predecessoras, lidos pelo código antigo. provisório: o ticket 20 passa a pedi-las às
// Dependências de Demandas, num fluxo do servidor.
import type { DatabaseSync } from "node:sqlite";
import { predecessorasDasDemandas } from "../armazenamento/dependencias_demanda.ts";
import { predecessorasPendentes } from "../nucleo/item_de_trabalho/dependencia_demanda.ts";

/** As predecessoras ainda não satisfeitas de cada demanda pedida, lidas de `banco` a cada pedido do Despacho. */
export const predecessorasPendentesNoBanco =
  (banco: DatabaseSync) =>
  (demandaIds: readonly string[]): Map<string, string[]> =>
    new Map(
      [...predecessorasDasDemandas(banco, demandaIds)].map(([demandaId, predecessoras]) => [
        demandaId,
        predecessorasPendentes(predecessoras),
      ]),
    );

// As predecessoras de cada demanda com o estado do desenvolvimento delas (comparacao-sdlc-implementacao.md §7.2), para o
// Despacho e as telas: junta a aresta de Dependências ao estado do processo. Gravar as arestas e achar os dependentes é
// de Demandas; esta leitura sai daqui quando o Despacho receber as demandas liberadas (ticket 20) e as consultas lerem
// pelas fachadas (ticket 21).
import type { DatabaseSync } from "node:sqlite";
import { EstadoDemanda } from "../nucleo/ciclo_de_vida/ciclos.ts";

/**
 * As predecessoras diretas de cada demanda de `ids` com o estado de cada uma, numa leitura só (sem N+1).
 * @testes o teste exercita direto; a produção a usa só dentro do módulo (a consulta que a usa vem em seguida)
 */
export function predecessorasDasDemandas(
  banco: DatabaseSync,
  ids: readonly string[],
): Map<string, { demanda_id: string; estado: EstadoDemanda }[]> {
  const linhas = banco
    .prepare(
      `SELECT dd.demanda_id AS dependente, d.id AS demanda_id, d.estado
       FROM dependencia_demanda dd JOIN demanda d ON d.id = dd.depende_demanda_id
       WHERE dd.demanda_id IN (SELECT value FROM json_each(?)) ORDER BY dd.rowid`,
    )
    .all(JSON.stringify(ids));
  // shortcut: filtra as linhas por demanda (ids × linhas), agrupar num passe só se passar de milhares de arestas.
  return new Map(
    ids.map((id) => [
      id,
      linhas
        .filter((l) => l.dependente === id)
        .map((l) => ({ demanda_id: l.demanda_id as string, estado: EstadoDemanda.parse(l.estado) })),
    ]),
  );
}

/** As predecessoras diretas de `id` com o estado de cada uma, para `predecessorasPendentes`. */
export const predecessorasDaDemanda = (
  banco: DatabaseSync,
  id: string,
): { demanda_id: string; estado: EstadoDemanda }[] => [...predecessorasDasDemandas(banco, [id]).values()].flat();

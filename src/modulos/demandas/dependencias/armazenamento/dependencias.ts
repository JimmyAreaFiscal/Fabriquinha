// As arestas de dependência entre pedidos no banco: lê e grava; as regras são do núcleo.
import type { DatabaseSync } from "node:sqlite";
import type { DependenciaDemanda } from "../nucleo/dependencia.ts";

/** Todas as arestas de dependência, na ordem em que foram gravadas. */
export const arestasDeDependencia = (banco: DatabaseSync): DependenciaDemanda[] =>
  banco
    .prepare("SELECT demanda_id, depende_demanda_id FROM dependencia_demanda ORDER BY rowid")
    .all()
    .map((linha) => ({ demanda_id: String(linha.demanda_id), depende_demanda_id: String(linha.depende_demanda_id) }));

/**
 * As predecessoras diretas de cada pedido de `ids`, na ordem em que as arestas foram gravadas, numa leitura só; o pedido
 * sem nenhuma vem com a lista vazia.
 */
export function predecessorasDosPedidosEmLote(banco: DatabaseSync, ids: readonly string[]): Map<string, string[]> {
  const predecessorasDoPedido = new Map(ids.map((id): [string, string[]] => [id, []]));
  const linhas = banco
    .prepare(
      `SELECT demanda_id, depende_demanda_id FROM dependencia_demanda
        WHERE demanda_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
    )
    .all(JSON.stringify(ids));
  for (const linha of linhas)
    predecessorasDoPedido.get(String(linha.demanda_id))?.push(String(linha.depende_demanda_id));
  return predecessorasDoPedido;
}

export const gravarDependencia = (
  banco: DatabaseSync,
  { demanda_id, depende_demanda_id }: DependenciaDemanda,
): void => {
  banco
    .prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)")
    .run(demanda_id, depende_demanda_id);
};

/** Na remoção do projeto: as dependências que citam os `pedidos`, de um lado ou do outro. */
export function apagarDependenciasDosPedidos(banco: DatabaseSync, pedidos: readonly string[]): void {
  banco
    .prepare(
      `DELETE FROM dependencia_demanda WHERE demanda_id IN (SELECT value FROM json_each($pedidos))
         OR depende_demanda_id IN (SELECT value FROM json_each($pedidos))`,
    )
    .run({ pedidos: JSON.stringify(pedidos) });
}

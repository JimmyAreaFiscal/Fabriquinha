// As arestas de dependência entre pedidos no banco: lê e grava; as regras são do núcleo.
import type { DatabaseSync } from "node:sqlite";
import { instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";
import type { DependenciaDemanda } from "../nucleo/dependencia.ts";
import { SituacaoDoPedido } from "../nucleo/pedido.ts";

/** Todas as arestas de dependência, na ordem em que foram gravadas. */
export const arestasDeDependencia = (banco: DatabaseSync): DependenciaDemanda[] =>
  banco
    .prepare("SELECT demanda_id, depende_demanda_id FROM dependencia_demanda ORDER BY rowid")
    .all()
    .map((linha) => ({ demanda_id: String(linha.demanda_id), depende_demanda_id: String(linha.depende_demanda_id) }));

/**
 * As arestas que dizem as relações dos pedidos `ids` e a situação de cada pedido que elas citam, numa leitura só: as
 * predecessoras diretas de cada um e, descendo pelo grafo, todas as arestas dos dependentes diretos e indiretos.
 */
export function arestasDasRelacoesDosPedidos(
  banco: DatabaseSync,
  ids: readonly string[],
): { arestas: DependenciaDemanda[]; situacoes: Map<string, SituacaoDoPedido> } {
  const linhas = instrucaoPreparada(
    banco,
    `WITH RECURSIVE alcancados(id) AS (
       SELECT value FROM json_each($ids)
       UNION
       SELECT aresta.demanda_id FROM dependencia_demanda aresta JOIN alcancados ON aresta.depende_demanda_id = alcancados.id
     )
     SELECT aresta.demanda_id, aresta.depende_demanda_id, dependente.situacao AS situacao_do_dependente,
            predecessora.situacao AS situacao_da_predecessora
       FROM dependencia_demanda aresta
       LEFT JOIN demanda dependente ON dependente.id = aresta.demanda_id
       LEFT JOIN demanda predecessora ON predecessora.id = aresta.depende_demanda_id
      WHERE aresta.depende_demanda_id IN (SELECT id FROM alcancados)
         OR aresta.demanda_id IN (SELECT value FROM json_each($ids))
      ORDER BY aresta.rowid`,
  ).all({ ids: JSON.stringify(ids) });
  const situacoes = new Map<string, SituacaoDoPedido>();
  const arestas = linhas.map((linha) => {
    const aresta = { demanda_id: String(linha.demanda_id), depende_demanda_id: String(linha.depende_demanda_id) };
    if (linha.situacao_do_dependente !== null)
      situacoes.set(aresta.demanda_id, SituacaoDoPedido.parse(linha.situacao_do_dependente));
    if (linha.situacao_da_predecessora !== null)
      situacoes.set(aresta.depende_demanda_id, SituacaoDoPedido.parse(linha.situacao_da_predecessora));
    return aresta;
  });
  return { arestas, situacoes };
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

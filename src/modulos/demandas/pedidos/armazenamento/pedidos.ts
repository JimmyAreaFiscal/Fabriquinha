// O pedido no banco: o conteúdo, a autoria, o envio e a situação, na linha da `demanda`, que só os Pedidos escrevem. O
// estado do desenvolvimento tem tabela própria, do Processo (desde a migração 52); as colunas antigas dele na linha
// (estado, instante da mudança e branch) ficaram sem uso.
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { instrucaoPreparada, novoId } from "../../../../shared/armazenamento/banco.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import { type Pedido, SituacaoDoPedido } from "../nucleo/pedido.ts";

/** O ID do pedido novo, da sequência das demandas; só dentro da unidade de trabalho que grava o pedido. */
export const alocarIdDoPedido = (banco: DatabaseSync): string => `I-${String(novoId(banco, "demanda"))}`;

const COLUNAS_DO_PEDIDO =
  "id, projeto, titulo, tipo, descricao, criada_por_ferramenta, criada_por_sessao, enviada, situacao";

const pedidoDaLinha = (linha: Record<string, SQLOutputValue>): Pedido => ({
  id: String(linha.id),
  projeto: String(linha.projeto),
  titulo: String(linha.titulo),
  tipo: linha.tipo as Pedido["tipo"],
  descricao: String(linha.descricao),
  criada_por: {
    tipo: "externo",
    ferramenta: String(linha.criada_por_ferramenta),
    sessao: String(linha.criada_por_sessao),
  },
  enviada: linha.enviada === 1,
  situacao: SituacaoDoPedido.parse(linha.situacao),
});

/** O pedido `id`; o inexistente dá `ErroDeInexistente`. */
export const lerPedido = (banco: DatabaseSync, id: string): Pedido =>
  pedidoDaLinha(
    encontrado(
      banco.prepare(`SELECT ${COLUNAS_DO_PEDIDO} FROM demanda WHERE id = ?`).get(id),
      `a demanda ${id} não existe`,
      "confira o id da demanda",
    ),
  );

/** Os pedidos `ids`, pelo id, numa leitura só; o id sem pedido não entra no mapa. */
export const lerPedidosEmLote = (banco: DatabaseSync, ids: readonly string[]): Map<string, Pedido> =>
  new Map(
    instrucaoPreparada(banco, `SELECT ${COLUNAS_DO_PEDIDO} FROM demanda WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(ids))
      .map((linha) => [String(linha.id), pedidoDaLinha(linha)]),
  );

/** Os ids dos pedidos do projeto, dos mais novos para os mais antigos. */
export const pedidosDoProjeto = (banco: DatabaseSync, projeto: string): string[] =>
  banco
    .prepare("SELECT id FROM demanda WHERE projeto = ? ORDER BY rowid DESC")
    .all(projeto)
    .map((linha) => String(linha.id));

/** Grava o pedido novo, com o ID que a sequência alocou. */
export const gravarPedidoNovo = (banco: DatabaseSync, pedido: Pedido): void => {
  banco
    .prepare(`INSERT INTO demanda (${COLUNAS_DO_PEDIDO}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      pedido.id,
      pedido.projeto,
      pedido.titulo,
      pedido.tipo,
      pedido.descricao,
      pedido.criada_por.ferramenta,
      pedido.criada_por.sessao,
      Number(pedido.enviada),
      pedido.situacao,
    );
};

/** A situação de cada pedido, numa leitura só. */
export const situacoesDosPedidos = (banco: DatabaseSync): Map<string, SituacaoDoPedido> =>
  new Map(
    banco
      .prepare("SELECT id, situacao FROM demanda")
      .all()
      .map((linha) => [String(linha.id), SituacaoDoPedido.parse(linha.situacao)]),
  );

/** O cadastro do pedido com o histórico administrativo: o registro e a conclusão gravados, ou `null` (a demanda nova). */
interface HistoricoDoPedido {
  id: string;
  projeto: string;
  titulo: string;
  criadaEm: string | null;
  concluidaEm: string | null;
}

/** O histórico dos pedidos `ids`, ou de todos sem `ids`, na ordem em que foram registrados, numa leitura só. */
export const historicoDosPedidosEmLote = (banco: DatabaseSync, ids?: readonly string[]): HistoricoDoPedido[] =>
  instrucaoPreparada(
    banco,
    `SELECT d.id, d.projeto, d.titulo, h.criada_em, h.concluida_em
       FROM demanda d LEFT JOIN demanda_historico h ON h.demanda_id = d.id
       WHERE $ids IS NULL OR d.id IN (SELECT value FROM json_each($ids)) ORDER BY d.rowid`,
  )
    .all({ ids: ids === undefined ? null : JSON.stringify(ids) })
    .map((linha) => ({
      id: String(linha.id),
      projeto: String(linha.projeto),
      titulo: String(linha.titulo),
      criadaEm: linha.criada_em === null ? null : String(linha.criada_em),
      concluidaEm: linha.concluida_em === null ? null : String(linha.concluida_em),
    }));

/** O achado da Avaliação de onde o pedido `id` foi encaminhado, ou `undefined` no pedido que não veio de um. */
export const origemDoPedido = (
  banco: DatabaseSync,
  id: string,
): { avaliacao_id: string; achado_id: number; titulo: string } | undefined =>
  banco.prepare("SELECT avaliacao_id, achado_id, titulo FROM achado_avaliacao WHERE demanda_id = ?").get(id) as
    { avaliacao_id: string; achado_id: number; titulo: string } | undefined;

export const gravarConteudoDoPedido = (banco: DatabaseSync, { id, titulo, tipo, descricao }: Pedido): void => {
  banco.prepare("UPDATE demanda SET titulo = ?, tipo = ?, descricao = ? WHERE id = ?").run(titulo, tipo, descricao, id);
};

export const gravarSituacaoDoPedido = (banco: DatabaseSync, { id, situacao }: Pedido): void => {
  banco.prepare("UPDATE demanda SET situacao = ? WHERE id = ?").run(situacao, id);
};

/** O pedido enviado: o conteúdo congela, e a situação passa a `enviado`. */
export const gravarEnvioDoPedido = (banco: DatabaseSync, { id, situacao }: Pedido): void => {
  banco.prepare("UPDATE demanda SET enviada = 1, situacao = ? WHERE id = ?").run(situacao, id);
};

/**
 * Na remoção do projeto: os pedidos dele, o histórico administrativo e as linhas históricas da Avaliação; o achado de
 * outro projeto encaminhado a um pedido daqui fica sem o pedido. O desenvolvimento e as dependências já saíram.
 */
export function apagarPedidosDoProjeto(banco: DatabaseSync, projeto: string): void {
  const p = { p: projeto };
  const dosPedidos = "SELECT id FROM demanda WHERE projeto = $p";
  const dasAvaliacoes = "SELECT id FROM avaliacao WHERE projeto = $p";
  const apagar = (tabela: string, onde: string) => banco.prepare(`DELETE FROM ${tabela} WHERE ${onde}`).run(p);
  banco.prepare(`UPDATE achado_avaliacao SET demanda_id = NULL WHERE demanda_id IN (${dosPedidos})`).run(p);
  apagar("uso_avaliacao", `avaliacao_id IN (${dasAvaliacoes})`);
  apagar("avaliacao_demanda", `avaliacao_id IN (${dasAvaliacoes}) OR demanda_id IN (${dosPedidos})`);
  apagar("achado_avaliacao", `avaliacao_id IN (${dasAvaliacoes})`);
  apagar("avaliacao", "projeto = $p");
  apagar("demanda_historico", `demanda_id IN (${dosPedidos})`);
  apagar("demanda", "projeto = $p");
}

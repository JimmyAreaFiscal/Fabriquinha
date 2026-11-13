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
/** As mesmas colunas, da `demanda d` da consulta que junta o histórico e a origem. */
const COLUNAS_DO_PEDIDO_NA_CONSULTA =
  "d.id, d.projeto, d.titulo, d.tipo, d.descricao, d.criada_por_ferramenta, d.criada_por_sessao, d.enviada, d.situacao";

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

/** O achado da Avaliação de onde o pedido foi encaminhado. */
interface OrigemDoPedido {
  readonly avaliacao_id: string;
  readonly achado_id: number;
  readonly titulo: string;
}

/** O pedido com o histórico administrativo e a origem: o que a consulta dos pedidos lê da linha de cada um. */
export interface PedidoComHistorico extends Pedido {
  /** O registro gravado no histórico, ou `null` (a demanda nova). */
  readonly criadaEm: string | null;
  /** A conclusão gravada no histórico, ou `null`. */
  readonly concluidaEm: string | null;
  /** O achado da Avaliação de onde o pedido foi encaminhado; ausente no pedido que não veio de um. */
  readonly origem?: OrigemDoPedido;
}

/** Quais pedidos ler: os `ids`, os do `projeto`, ou todos sem nenhum dos dois. */
export interface FiltroDePedidos {
  readonly ids?: readonly string[];
  readonly projeto?: string;
}

/**
 * Os pedidos do `filtro`, na ordem em que foram registrados, com o histórico e a origem, numa leitura só. Cada pedido vem
 * de no máximo um achado (`demanda_id` é único na tabela).
 */
export const lerPedidosDoFiltro = (banco: DatabaseSync, { ids, projeto }: FiltroDePedidos): PedidoComHistorico[] =>
  instrucaoPreparada(
    banco,
    `SELECT ${COLUNAS_DO_PEDIDO_NA_CONSULTA}, h.criada_em, h.concluida_em, o.avaliacao_id, o.achado_id, o.titulo AS titulo_do_achado
       FROM demanda d
       LEFT JOIN demanda_historico h ON h.demanda_id = d.id
       LEFT JOIN achado_avaliacao o ON o.demanda_id = d.id
      WHERE ($ids IS NULL OR d.id IN (SELECT value FROM json_each($ids))) AND ($projeto IS NULL OR d.projeto = $projeto)
      ORDER BY d.rowid`,
  )
    .all({ ids: ids === undefined ? null : JSON.stringify(ids), projeto: projeto ?? null })
    .map((linha) => ({
      ...pedidoDaLinha(linha),
      criadaEm: linha.criada_em === null ? null : String(linha.criada_em),
      concluidaEm: linha.concluida_em === null ? null : String(linha.concluida_em),
      ...(linha.avaliacao_id === null
        ? {}
        : {
            origem: {
              avaliacao_id: String(linha.avaliacao_id),
              achado_id: Number(linha.achado_id),
              titulo: String(linha.titulo_do_achado),
            },
          }),
    }));

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

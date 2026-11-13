// O pedido no banco: o conteúdo, a autoria, o envio e a situação, colunas da linha da `demanda`. A linha nasce com o
// processo, que a grava com o conteúdo recebido do pedido; as colunas do processo na mesma linha (estado, branch e o
// `enviada`, que o processo grava ao aceitar o envio) são do Ciclo de Vida, e só ele as escreve.
import type { DatabaseSync } from "node:sqlite";
import { novoId } from "../../../../shared/armazenamento/banco.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import { type Pedido, SituacaoDoPedido } from "../nucleo/pedido.ts";

/** O ID do pedido novo, da sequência das demandas; só dentro da unidade de trabalho que grava o pedido. */
export const alocarIdDoPedido = (banco: DatabaseSync): string => `I-${String(novoId(banco, "demanda"))}`;

/** O pedido `id`; o inexistente dá `ErroDeInexistente`. */
export function lerPedido(banco: DatabaseSync, id: string): Pedido {
  const linha = encontrado(
    banco
      .prepare(
        `SELECT id, projeto, titulo, tipo, descricao, criada_por_ferramenta, criada_por_sessao, enviada, situacao
           FROM demanda WHERE id = ?`,
      )
      .get(id),
    `a demanda ${id} não existe`,
    "confira o id da demanda",
  );
  return {
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
  };
}

/** A situação de cada pedido, numa leitura só. */
export const situacoesDosPedidos = (banco: DatabaseSync): Map<string, SituacaoDoPedido> =>
  new Map(
    banco
      .prepare("SELECT id, situacao FROM demanda")
      .all()
      .map((linha) => [String(linha.id), SituacaoDoPedido.parse(linha.situacao)]),
  );

export const gravarConteudoDoPedido = (banco: DatabaseSync, { id, titulo, tipo, descricao }: Pedido): void => {
  banco.prepare("UPDATE demanda SET titulo = ?, tipo = ?, descricao = ? WHERE id = ?").run(titulo, tipo, descricao, id);
};

export const gravarSituacaoDoPedido = (banco: DatabaseSync, { id, situacao }: Pedido): void => {
  banco.prepare("UPDATE demanda SET situacao = ? WHERE id = ?").run(situacao, id);
};

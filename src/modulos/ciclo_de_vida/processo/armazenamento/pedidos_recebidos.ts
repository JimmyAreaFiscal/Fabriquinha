// O conteúdo dos pedidos, que o Processo recebe como dado (MELHORIAS §11, regra 2): o projeto, o título, o tipo, a
// descrição, quem o registrou e se já foi enviado são de Demandas, e o Ciclo de Vida não importa Demandas. A composição
// liga aqui a leitura deles; o agregado da demanda junta esse conteúdo ao estado do desenvolvimento, que é do Processo.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../../shared/nucleo/erros.ts";

/** O pedido como o Processo o lê: o conteúdo, o Ator externo que o registrou e se ele já foi enviado. */
export interface PedidoRecebido {
  readonly id: string;
  readonly projeto: string;
  readonly titulo: string;
  readonly tipo: string;
  readonly descricao: string;
  readonly criada_por: { readonly tipo: "externo"; readonly ferramenta: string; readonly sessao: string };
  readonly enviada: boolean;
}

/** A leitura dos pedidos que a composição liga. */
interface LeituraDosPedidosRecebidos {
  /** Os pedidos `ids`, pelo id, numa leitura só; o id sem pedido não entra no mapa. */
  lerPedidosEmLote(banco: DatabaseSync, ids: readonly string[]): ReadonlyMap<string, PedidoRecebido>;
}

let leituraLigada: LeituraDosPedidosRecebidos | undefined;

/** A composição liga a leitura dos pedidos de Demandas, uma vez, antes de qualquer leitura do agregado. */
export const ligarLeituraDosPedidosRecebidos = (leitura: LeituraDosPedidosRecebidos): void => {
  leituraLigada = leitura;
};

/** Os pedidos `ids`, pela leitura que a composição ligou. */
export const pedidosRecebidosEmLote = (
  banco: DatabaseSync,
  ids: readonly string[],
): ReadonlyMap<string, PedidoRecebido> =>
  encontrado(
    leituraLigada,
    "a leitura dos pedidos não foi ligada ao Ciclo de Vida",
    "abra o banco por abrirBancoDaFabriquinha, que liga a leitura de Demandas",
  ).lerPedidosEmLote(banco, ids);

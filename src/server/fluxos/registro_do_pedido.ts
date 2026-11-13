// O fluxo do registro do pedido, entre Demandas e o Ciclo de Vida: o pedido, o processo dele (no estado da primeira
// Etapa) e as dependências do pedido nascem na mesma unidade de trabalho, a do registro do pedido. Qualquer erro desfaz
// tudo, ID incluído (CA-1, CA-2).
import type { DatabaseSync } from "node:sqlite";
import {
  type AgregadoDemanda,
  type Ator,
  type ContextoDemanda,
  criarProcessoDoPedido,
} from "../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas, NovoPedido } from "../../modulos/demandas/publico.ts";

export const registrarPedidoComProcesso = (
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  novo: NovoPedido,
  autor: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda => gestaoDeDemandas.registrar(novo, autor, (pedido) => criarProcessoDoPedido(banco, pedido, ctx));

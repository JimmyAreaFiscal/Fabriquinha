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
import { registrarDependencia, registrarPedido } from "../../modulos/demandas/publico.ts";

/** O conteúdo do pedido (projeto, título, tipo, descrição) e as demandas de que ele depende. */
type EntradaDoRegistro = { dependencias?: string[] } & Record<string, unknown>;

export function registrarPedidoComProcesso(
  banco: DatabaseSync,
  entrada: EntradaDoRegistro,
  autor: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  const { dependencias = [], ...conteudo } = entrada;
  return registrarPedido(banco, conteudo, autor, (pedido) => {
    const processo = criarProcessoDoPedido(banco, pedido, ctx);
    for (const dependeId of dependencias) registrarDependencia(banco, pedido.id, dependeId);
    return processo;
  });
}

// Os casos de uso das Dependências entre pedidos: registrar a aresta, ler as relações de cada pedido (as predecessoras e
// os dependentes que ainda não terminaram) e cancelar o pedido com os dependentes. A dependência só olha a situação
// administrativa dos pedidos.
import type { DatabaseSync } from "node:sqlite";
import { escrever } from "../../../../shared/armazenamento/banco.ts";
import { dependenciaNovaValidada, type RelacoesDoPedido, relacoesNoGrafo } from "../nucleo/dependencia.ts";
import {
  arestasDasRelacoesDosPedidos,
  arestasDeDependencia,
  gravarDependencia,
} from "../armazenamento/dependencias.ts";
import { lerPedido } from "../armazenamento/pedidos.ts";
import { registrarCancelamentoDosPedidos } from "./gestao_de_pedidos.ts";

/** Registra `demandaId` como dependente de `dependeId`; os dois pedidos precisam existir e a regra recusa envio, repetição e ciclo. */
export const registrarDependencia = (banco: DatabaseSync, demandaId: string, dependeId: string): void => {
  escrever(banco, () => {
    const pedido = lerPedido(banco, demandaId);
    lerPedido(banco, dependeId);
    gravarDependencia(banco, dependenciaNovaValidada(arestasDeDependencia(banco), pedido, dependeId));
  });
};

/** As relações gravadas de cada pedido de `ids` no grafo das dependências; quem chama garante o snapshot. */
export function relacoesGravadasDosPedidos(
  banco: DatabaseSync,
  ids: readonly string[],
): (id: string) => RelacoesDoPedido {
  const { arestas, situacoes } = arestasDasRelacoesDosPedidos(banco, ids);
  return relacoesNoGrafo(arestas, situacoes);
}

/**
 * O cancelamento em cascata do lado dos pedidos: lê os dependentes de `id` que ainda não terminaram, entrega-os a
 * `cancelarOsProcessos` (que cancela, na mesma unidade de trabalho, os processos e diz quais pedidos foram cancelados) e
 * registra o cancelamento desses pedidos. Os dependentes são lidos dentro da transação, sem janela para dependente nova.
 */
export const cancelarComDependentes = <Cancelamento extends { readonly canceladas: readonly string[] }>(
  banco: DatabaseSync,
  id: string,
  cancelarOsProcessos: (dependentes: string[]) => Cancelamento,
): Cancelamento =>
  escrever(banco, () => {
    const relacoesDe = relacoesGravadasDosPedidos(banco, [id]);
    const cancelamento = cancelarOsProcessos([...relacoesDe(id).dependentesPendentes]);
    registrarCancelamentoDosPedidos(banco, cancelamento.canceladas);
    return cancelamento;
  });

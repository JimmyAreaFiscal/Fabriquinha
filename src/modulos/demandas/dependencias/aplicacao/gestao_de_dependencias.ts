// Os casos de uso das Dependências entre pedidos: registrar a aresta, informar os dependentes que ainda não terminaram e
// os pedidos liberados (sem predecessora por concluir).
// Os pedidos são lidos pela API dos Pedidos; a dependência só olha a situação administrativa deles.
import type { DatabaseSync } from "node:sqlite";
import { escrever } from "../../../../shared/armazenamento/banco.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import { lerPedido, registrarCancelamentoDosPedidos, situacoesDosPedidos } from "../../pedidos/publico.ts";
import {
  dependenciaNovaValidada,
  dependentesNaoConcluidos,
  predecessorasNaoConcluidas,
} from "../nucleo/dependencia.ts";
import { arestasDeDependencia, gravarDependencia } from "../armazenamento/dependencias.ts";

/** Registra `demandaId` como dependente de `dependeId`; os dois pedidos precisam existir e a regra recusa envio, repetição e ciclo. */
export const registrarDependencia = (banco: DatabaseSync, demandaId: string, dependeId: string): void => {
  escrever(banco, () => {
    const pedido = lerPedido(banco, demandaId);
    lerPedido(banco, dependeId);
    gravarDependencia(banco, dependenciaNovaValidada(arestasDeDependencia(banco), pedido, dependeId));
  });
};

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
    const cancelamento = cancelarOsProcessos(dependentesNaoConcluidosDoPedido(banco, id));
    registrarCancelamentoDosPedidos(banco, cancelamento.canceladas);
    return cancelamento;
  });

/** Os dependentes de `id` (diretos e indiretos) que ainda não terminaram, lidos num snapshot só. */
export const dependentesNaoConcluidosDoPedido = (banco: DatabaseSync, id: string): string[] =>
  lerEmSnapshot(banco, () => dependentesNaoConcluidos(arestasDeDependencia(banco), situacoesDosPedidos(banco), id));

/**
 * As predecessoras ainda não concluídas de cada pedido de `ids`, lidas num snapshot só: o pedido sem nenhuma está
 * liberado. ponytail: lê todas as arestas e situações (o despacho pede a cada minuto); filtrar por `ids` no SQL se passar
 * de milhares de pedidos.
 */
export const predecessorasPendentesDosPedidos = (banco: DatabaseSync, ids: readonly string[]): Map<string, string[]> =>
  lerEmSnapshot(banco, () => predecessorasNaoConcluidas(arestasDeDependencia(banco), situacoesDosPedidos(banco), ids));

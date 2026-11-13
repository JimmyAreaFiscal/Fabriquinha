// O lado do processo no cancelamento em cascata (D08): a demanda que termina `cancelada` leva junto os processos das
// dependentes. Quais são as dependentes é de Demandas; o fluxo do servidor (`server/fluxos/cancelamento_em_cascata.ts`)
// lê as dependentes, chama estas funções e registra o cancelamento dos pedidos na mesma unidade de trabalho.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../nucleo/demanda/agregado_demanda.ts";
import type { Ator } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { cancelarDemanda } from "../../nucleo/ciclo_de_vida/cancelamento_demanda.ts";
import type { ContextoDemanda } from "../../nucleo/transicoes/transicoes_demanda.ts";
import { escrever } from "../../../compartilhado/armazenamento/banco.ts";
import { comDemanda } from "../../armazenamento/demandas.ts";
import { processosAbertos } from "../../../trabalho_agentico/armazenamento/trabalho_agentico.ts";
import { interromperExecucaoDemanda } from "../execucao/execucao_demanda.ts";

/**
 * Aplica `transicao` à demanda `id` e, se ela terminou `cancelada`, cancela os processos de `dependentes` na mesma
 * transação; `canceladas` traz a demanda e as dependentes, ou nada se ela não foi cancelada.
 */
export const cancelarProcessosEmCascata = (
  banco: DatabaseSync,
  id: string,
  dependentes: readonly string[],
  ator: Ator,
  ctx: ContextoDemanda,
  transicao: (ag: AgregadoDemanda) => AgregadoDemanda,
): { demanda: AgregadoDemanda; canceladas: string[] } =>
  escrever(banco, () => {
    const principal = comDemanda(banco, id, transicao);
    if (principal.demanda.estado !== "cancelada") return { demanda: principal, canceladas: [] };
    for (const dependente of dependentes) comDemanda(banco, dependente, (ag) => cancelarDemanda(ag, ator, ctx));
    return { demanda: principal, canceladas: [id, ...dependentes] };
  });

/** Interrompe, uma vez por ticket, as execuções abertas das demandas `canceladas`; roda depois do commit. */
export function interromperExecucoesDasDemandas(banco: DatabaseSync, canceladas: readonly string[]): void {
  const abertas = processosAbertos(banco).filter((e) => canceladas.includes(e.demanda_id));
  const tickets = new Map(
    abertas.map(({ demanda_id, ticket_id }) => [`${demanda_id}.${String(ticket_id)}`, { demanda_id, ticket_id }]),
  );
  for (const ref of tickets.values()) interromperExecucaoDemanda(banco, ref);
}

// Cancelamento em cascata (D08): a demanda que termina `cancelada` leva as dependentes não terminadas junto.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../../demanda/nucleo/agregado_demanda.ts";
import type { Ator } from "../../nucleo/ator.ts";
import { cancelarDemanda } from "../../nucleo/ciclo_de_vida/cancelamento_demanda.ts";
import type { ContextoDemanda } from "../../nucleo/transicoes/transicoes_demanda.ts";
import { escrever } from "../../../compartilhado/armazenamento/banco.ts";
import { comDemanda } from "../../../demanda/armazenamento/demandas.ts";
import { dependentesNaoConcluidasDaDemanda } from "../../../demanda/armazenamento/dependencias_demanda.ts";
import { processosAbertos } from "../../../execucao/armazenamento/trabalho_agentico.ts";
import { interromperExecucaoDemanda } from "../../../execucao/aplicacao/execucao_demanda.ts";

/**
 * Aplica `transicao` à demanda e, se ela terminou `cancelada`, cancela as dependentes não terminadas na mesma transação
 * (a leitura das dependentes é interna, sem janela para dependente nova). Só depois do commit as execuções abertas das
 * canceladas são interrompidas, uma vez por ticket.
 */
export function cancelandoEmCascata(
  banco: DatabaseSync,
  id: string,
  ator: Ator,
  ctx: ContextoDemanda,
  transicao: (ag: AgregadoDemanda) => AgregadoDemanda,
): { demanda: AgregadoDemanda; canceladas: string[] } {
  const { demanda, canceladas } = escrever(banco, () => {
    const dependentes = dependentesNaoConcluidasDaDemanda(banco, id);
    const principal = comDemanda(banco, id, transicao);
    if (principal.demanda.estado !== "cancelada") return { demanda: principal, canceladas: [] };
    for (const d of dependentes) comDemanda(banco, d, (ag) => cancelarDemanda(ag, ator, ctx));
    return { demanda: principal, canceladas: [id, ...dependentes] };
  });
  const abertas = processosAbertos(banco).filter((e) => canceladas.includes(e.demanda_id));
  const tickets = new Map(
    abertas.map(({ demanda_id, ticket_id }) => [`${demanda_id}.${String(ticket_id)}`, { demanda_id, ticket_id }]),
  );
  for (const ref of tickets.values()) interromperExecucaoDemanda(banco, ref);
  return { demanda, canceladas };
}

// O fluxo do cancelamento em cascata (MELHORIAS §5.3, D08), entre Demandas e o Ciclo de Vida: o pedido, os dependentes que
// ainda não terminaram e os processos de todos são cancelados na mesma unidade de trabalho; as sessões abertas deles são
// interrompidas só depois do commit. Cancela assim o Auditor que cancela a demanda e o Gate da demanda que a reprova.
import type { DatabaseSync } from "node:sqlite";
import { type Relogio, relogioDoSistema } from "../../shared/nucleo/relogio.ts";
import {
  type AgregadoDemanda,
  type Ator,
  cancelarDemanda,
  cancelarProcessosEmCascata,
  comCampoInvalidoComoErroDeRegra,
  type ContextoDemanda,
  Endereco,
  GATE_DA_DEMANDA,
  interromperExecucoesDasDemandas,
} from "../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../modulos/demandas/publico.ts";

/** A demanda depois da transição e as que ela levou junto (vazia se ela não terminou `cancelada`). */
interface ResultadoDaCascata {
  demanda: AgregadoDemanda;
  canceladas: string[];
}

/**
 * Aplica `transicao` ao processo `id` e, se ele terminou `cancelado`, cancela os dependentes não terminados: os
 * dependentes são lidos dentro da transação, sem janela para dependente nova. Depois do commit, as execuções abertas
 * dos cancelados são interrompidas, uma vez por ticket.
 */
function cancelarEmCascata(
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
  ator: Ator,
  ctx: ContextoDemanda,
  transicao: (ag: AgregadoDemanda) => AgregadoDemanda,
): ResultadoDaCascata {
  const cascata = gestaoDeDemandas.cancelar(id, (dependentes) =>
    cancelarProcessosEmCascata(banco, id, dependentes, ator, ctx, transicao),
  );
  interromperExecucoesDasDemandas(banco, cascata.canceladas);
  return cascata;
}

/** CA-21 a CA-26: só o Auditor, até a integração confirmada; o histórico fica intacto e os dependentes saem junto. */
export const cancelarDemandaEmCascata = (
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
  ator: Ator,
  ctx: ContextoDemanda,
): ResultadoDaCascata =>
  comCampoInvalidoComoErroDeRegra(() =>
    cancelarEmCascata(banco, gestaoDeDemandas, id, ator, ctx, (ag) => cancelarDemanda(ag, ator, ctx)),
  );

/** CA-16 a CA-20: o Auditor decide o Gate da demanda; aprovar não cascateia, reprovar cancela a demanda e os dependentes. */
export const decidirGateDaDemanda = (
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
  entrada: unknown,
  ator: Ator,
  relogio: Relogio = relogioDoSistema,
): ResultadoDaCascata => {
  const ctx = { agora: relogio.agora() };
  return cancelarEmCascata(banco, gestaoDeDemandas, id, ator, ctx, (ag) =>
    GATE_DA_DEMANDA.decidir(ag, Endereco.daDemanda(id), entrada, ator, ctx),
  );
};

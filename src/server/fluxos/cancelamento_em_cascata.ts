// O fluxo do cancelamento em cascata (MELHORIAS §5.3, D08), entre Demandas e o Ciclo de Vida: o pedido, os dependentes que
// ainda não terminaram e os processos de todos são cancelados na mesma unidade de trabalho; as sessões abertas deles são
// interrompidas só depois do commit. Cancela assim o Auditor que cancela a demanda e o Gate da demanda que a reprova.
import type { DatabaseSync } from "node:sqlite";
import { type Relogio, relogioDoSistema } from "../../shared/nucleo/relogio.ts";
import { type Ator, Endereco } from "../../modulos/ciclo_de_vida/publico.ts";
import { cancelarComDependentes } from "../../modulos/demandas/publico.ts";
import type { AgregadoDemanda } from "../../modulos/sdlc/nucleo/demanda/agregado_demanda.ts";
import type { ContextoDemanda } from "../../modulos/sdlc/nucleo/transicoes/transicoes_demanda.ts";
import { cancelarDemanda } from "../../modulos/sdlc/nucleo/ciclo_de_vida/cancelamento_demanda.ts";
import { comCampoInvalidoComoErroDeRegra } from "../../modulos/sdlc/aplicacao/gestao_demandas.ts";
import {
  cancelarProcessosEmCascata,
  interromperExecucoesDasDemandas,
} from "../../modulos/sdlc/aplicacao/gates/cancelamento_em_cascata.ts";
import { GATE_DA_DEMANDA } from "../../modulos/etapas/gates.ts";

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
  id: string,
  ator: Ator,
  ctx: ContextoDemanda,
  transicao: (ag: AgregadoDemanda) => AgregadoDemanda,
): ResultadoDaCascata {
  const cascata = cancelarComDependentes(banco, id, (dependentes) =>
    cancelarProcessosEmCascata(banco, id, dependentes, ator, ctx, transicao),
  );
  interromperExecucoesDasDemandas(banco, cascata.canceladas);
  return cascata;
}

/** CA-21 a CA-26: só o Auditor, até a integração confirmada; o histórico fica intacto e os dependentes saem junto. */
export const cancelarDemandaEmCascata = (
  banco: DatabaseSync,
  id: string,
  ator: Ator,
  ctx: ContextoDemanda,
): ResultadoDaCascata =>
  comCampoInvalidoComoErroDeRegra(() =>
    cancelarEmCascata(banco, id, ator, ctx, (ag) => cancelarDemanda(ag, ator, ctx)),
  );

/** CA-16 a CA-20: o Auditor decide o Gate da demanda; aprovar não cascateia, reprovar cancela a demanda e os dependentes. */
export const decidirGateDaDemanda = (
  banco: DatabaseSync,
  id: string,
  entrada: unknown,
  ator: Ator,
  relogio: Relogio = relogioDoSistema,
): ResultadoDaCascata => {
  const ctx = { agora: relogio.agora() };
  return cancelarEmCascata(banco, id, ator, ctx, (ag) =>
    GATE_DA_DEMANDA.decidir(ag, Endereco.daDemanda(id), entrada, ator, ctx),
  );
};

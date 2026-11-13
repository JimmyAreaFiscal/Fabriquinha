// O fluxo da conclusão do desenvolvimento (MELHORIAS §5.3), entre o Ciclo de Vida e Demandas: o encerramento do processo
// (integração e limpeza confirmadas) e a conclusão do pedido são gravados na mesma unidade de trabalho. A condução do
// `encerrar_demanda` o recebe da composição e lhe entrega a gravação do encerramento.
import type { DatabaseSync } from "node:sqlite";
import { registrarConclusaoDoPedido } from "../../modulos/demandas/publico.ts";

/** A conclusão no `banco`, na forma que a condução do `encerrar_demanda` pede: o pedido e a gravação do encerramento. */
export const concluirDesenvolvimentoNoBanco =
  (banco: DatabaseSync) =>
  (demandaId: string, gravarEncerramentoDoProcesso: () => void): void => {
    registrarConclusaoDoPedido(banco, demandaId, gravarEncerramentoDoProcesso);
  };

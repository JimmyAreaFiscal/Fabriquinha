// O fluxo do cancelamento em cascata (MELHORIAS §5.3, D08), entre Demandas e o Ciclo de Vida: o pedido, os dependentes que
// ainda não terminaram e os processos de todos são cancelados na mesma unidade de trabalho; as sessões abertas deles são
// interrompidas só depois do commit. Cancela assim o Auditor que cancela a demanda e o Gate da demanda que a reprova.
import type { CascataDoCancelamento, CicloDeVida } from "../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../modulos/demandas/publico.ts";

/** A demanda depois da transição e as que ela levou junto (vazia se ela não terminou `cancelada`). */
type ResultadoDaCascata = Omit<CascataDoCancelamento, "interromperExecucoes">;

/**
 * Demandas lê os dependentes não terminados de `id` dentro da transação, sem janela para dependente nova, e o Ciclo de
 * Vida aplica a transição; depois do commit, as execuções abertas dos cancelados são interrompidas, uma vez por ticket.
 */
function cancelarEmCascata(
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
  transicao: (dependentes: string[]) => CascataDoCancelamento,
): ResultadoDaCascata {
  const cascata = gestaoDeDemandas.cancelar(id, transicao);
  cascata.interromperExecucoes();
  return { demanda: cascata.demanda, canceladas: cascata.canceladas };
}

/** CA-21 a CA-26: só o Auditor, até a integração confirmada; o histórico fica intacto e os dependentes saem junto. */
export const cancelarDemandaEmCascata = (
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
): ResultadoDaCascata =>
  cancelarEmCascata(gestaoDeDemandas, id, (dependentes) => cicloDeVida.cancelar(id, dependentes));

/** CA-16 a CA-20: o Auditor decide o Gate da demanda; aprovar não cascateia, reprovar cancela a demanda e os dependentes. */
export const decidirGateDaDemanda = (
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
  entrada: unknown,
): ResultadoDaCascata =>
  cancelarEmCascata(gestaoDeDemandas, id, (dependentes) =>
    cicloDeVida.decidir({ gate: "gate_demanda", demanda: id, entrada, dependentes }),
  );

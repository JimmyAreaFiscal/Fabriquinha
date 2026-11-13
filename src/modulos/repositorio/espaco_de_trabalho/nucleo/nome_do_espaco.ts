// O nome de um Espaço de Trabalho (CONCEITOS.md §7): o dono dele (a demanda ou uma rodada dela) e a branch. O Repositório é
// o dono desses nomes, porque o identificador da demanda vira pasta e branch: o Ciclo de Vida pede a branch da demanda e a
// da rodada pela fachada, em vez de montá-las, e informa só o identificador da demanda e o número da rodada.
import { z } from "zod";
import { Id } from "../../../../shared/nucleo/primitivos.ts";

// Letras + hífen + número (`I-196`): sem `/`, `.`, `..`, espaço ou `-` duplo, e sem colidir `fabriquinha/{demanda}-{rodada}`
// com a branch de outra demanda (uma demanda sempre termina em `-n` com prefixo só de letras).
export const DemandaId = z
  .string()
  .regex(/^[A-Za-z]{1,16}-[1-9][0-9]{0,9}$/, "use letras, hífen e número, como I-196 (sem barra, ponto ou espaço)");

/** A rodada dona de um Espaço: a demanda e o número da rodada nela. */
export const RodadaDoEspaco = z.object({ demanda_id: DemandaId, rodada_id: Id });

/** O dono de um Espaço: a demanda e, no Espaço da rodada, a rodada. */
interface DonoDoEspaco {
  readonly demanda_id: string;
  readonly rodada_id?: number;
}

export const branchDemanda = (demandaId: string): string => `fabriquinha/${DemandaId.parse(demandaId)}`;
export const branchRodada = (demandaId: string, rodadaId: number): string => {
  const ref = RodadaDoEspaco.parse({ demanda_id: demandaId, rodada_id: rodadaId });
  return `fabriquinha/${ref.demanda_id}-${String(ref.rodada_id)}`;
};

/**
 * O dono por extenso, que ocupa o Ambiente do Espaço: `I-n` ou `I-n.Rm`. É a forma do endereço público da demanda e da
 * rodada, que o Ambiente já guarda como ocupante das alocações.
 */
export const ocupanteDoDono = ({ demanda_id, rodada_id }: DonoDoEspaco): string =>
  rodada_id === undefined ? demanda_id : `${demanda_id}.R${String(rodada_id)}`;

export type DemandaId = z.infer<typeof DemandaId>;

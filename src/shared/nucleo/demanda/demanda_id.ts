// O identificador da demanda (CONCEITOS.md §1), compartilhado por todos os módulos: vira pasta e branch no Repositório,
// chave no Ciclo de Vida e em Demandas.
import { z } from "zod";

// Letras + hífen + número (`I-196`): sem `/`, `.`, `..`, espaço ou `-` duplo, e sem colidir `fabriquinha/{demanda}-{rodada}`
// com a branch de outra demanda (uma demanda sempre termina em `-n` com prefixo só de letras).
export const DemandaId = z
  .string()
  .regex(/^[A-Za-z]{1,16}-[1-9][0-9]{0,9}$/, "use letras, hífen e número, como I-196 (sem barra, ponto ou espaço)");

export type DemandaId = z.infer<typeof DemandaId>;

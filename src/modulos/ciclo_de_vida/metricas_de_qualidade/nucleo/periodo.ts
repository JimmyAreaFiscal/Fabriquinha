// O período de meses das Métricas (F6 §5.7), o filtro das visões; os meses e seus intervalos são do shared.
import { z } from "zod";
import { Mes } from "../../../../shared/nucleo/periodo.ts";
import { Slug } from "../../../../shared/nucleo/primitivos.ts";

/** O filtro das visões: de `de` até `ate`, inclusive; sem `projeto`, todos. */
export const Periodo = z
  .object({ projeto: Slug.optional(), de: Mes, ate: Mes })
  .refine((p) => p.de <= p.ate, "`de` não pode ser depois de `ate`");

export type Periodo = z.input<typeof Periodo>;

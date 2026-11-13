// O modelo do agente e o esforço de raciocínio dele (MELHORIAS §9, Modelos). Fonte única: o schema gera o tipo e valida em
// runtime (D2).
import { z } from "zod";
import { Slug } from "../../../../shared/nucleo/primitivos.ts";

// Os níveis de `pi --thinking`.
export const Effort = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
/** O modelo do agente é sempre o par inteiro: provedor e nome vêm juntos, ou não há modelo. */
export const Modelo = z.object({ provedor: Slug, nome: z.string().trim().min(1).max(200) });

export type Effort = z.infer<typeof Effort>;
export type Modelo = z.infer<typeof Modelo>;

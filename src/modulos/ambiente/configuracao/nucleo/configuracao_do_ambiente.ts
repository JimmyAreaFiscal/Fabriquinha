// A Configuração do Ambiente (CONCEITOS.md §7): onde o trabalho roda, os limites de cada Ambiente que o conjunto cria e
// como o conjunto cresce (MELHORIAS §13, item 1): o fixo cria até a capacidade e mantém os que criou; o variável cria
// até a capacidade (sem ela, sem teto) e elimina os ociosos até o mínimo.
import { z } from "zod";

/** Onde o trabalho roda: `host_local` por padrão; no container, cada um nasce com estes limites. */
export const ConfiguracaoDoAmbiente = z
  .object({
    tipo: z.enum(["host_local", "container"]).default("host_local"),
    memoria_maxima_mb: z.number().int().min(512).default(2048),
    cpus: z.number().positive().default(2),
    ociosidade_para_eliminar_min: z.number().int().min(5).default(60),
    conjunto: z.enum(["fixo", "variavel"]).default("variavel"),
    capacidade_do_conjunto: z.number().int().min(1).nullable().default(null),
    minimo_do_conjunto: z.number().int().min(0).default(0),
  })
  .superRefine(({ conjunto, capacidade_do_conjunto, minimo_do_conjunto }, contexto) => {
    if (conjunto === "fixo" && capacidade_do_conjunto === null)
      contexto.addIssue({
        code: "custom",
        path: ["capacidade_do_conjunto"],
        message: "o conjunto fixo precisa de uma capacidade",
      });
    if (conjunto === "variavel" && capacidade_do_conjunto !== null && minimo_do_conjunto > capacidade_do_conjunto)
      contexto.addIssue({
        code: "custom",
        path: ["minimo_do_conjunto"],
        message: "o mínimo passa da capacidade do conjunto",
      });
  });

export type ConfiguracaoDoAmbiente = z.infer<typeof ConfiguracaoDoAmbiente>;

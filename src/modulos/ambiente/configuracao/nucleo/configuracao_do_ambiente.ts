// A Configuração do Ambiente (CONCEITOS.md §7): onde o trabalho roda e os limites de cada Ambiente que o conjunto cria.
import { z } from "zod";

/** Onde o trabalho roda: `host_local` por padrão; no container, cada um nasce com estes limites. */
export const ConfiguracaoDoAmbiente = z.object({
  tipo: z.enum(["host_local", "container"]).default("host_local"),
  memoria_maxima_mb: z.number().int().min(512).default(2048),
  cpus: z.number().positive().default(2),
  ociosidade_para_eliminar_min: z.number().int().min(5).default(60),
});

export type ConfiguracaoDoAmbiente = z.infer<typeof ConfiguracaoDoAmbiente>;

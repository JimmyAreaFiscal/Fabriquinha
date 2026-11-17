// O contrato da rota da tela Ambientes (F7 §4.2): o que a resposta carrega. Só tipos e schemas.
import { z } from "zod";
import { ConfiguracaoDoAmbiente } from "../../../../shared/nucleo/configuracao_do_ambiente.ts";

/** Um container do conjunto e quem o ocupa; sem ocupante (livre ou sujo, ou que o Ciclo de Vida não reconhece), os campos dele são `null`. */
const ContainerDoAmbiente = z.strictObject({
  id: z.string(),
  /** O nome no docker; `null` quando o docker não respondeu à medição. */
  nome_do_container: z.string().nullable(),
  imagem: z.string(),
  estado: z.enum(["livre", "alocado", "sujo", "eliminado"]),
  /** O uso de CPU (em núcleos) e de memória medido agora; `null` quando o docker não respondeu. */
  medido: z.strictObject({ cpus: z.number(), memoria_mb: z.number() }).nullable(),
  projeto: z.string().nullable(),
  demanda: z.string().nullable(),
  /** O ticket (ou os tickets) em execução no Espaço que ocupa o container; `null` entre um ticket e outro. */
  ticket: z.string().nullable(),
  worktree: z.string().nullable(),
  branch: z.string().nullable(),
});

/** `GET /api/ambientes`: o tipo do Ambiente e, no `container`, o conjunto com o ocupante de cada um; no `host_local`, nenhum. */
export const AmbientesEmUso = z.strictObject({
  tipo: ConfiguracaoDoAmbiente.shape.tipo,
  containers: z.array(ContainerDoAmbiente),
});
export type AmbientesEmUso = z.infer<typeof AmbientesEmUso>;

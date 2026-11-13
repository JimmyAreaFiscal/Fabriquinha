// Primitivos do domínio (F1 §3.1), que não são do shared. Fonte única: o schema gera o tipo e valida em runtime (D2).
import { z } from "zod";

// provisório: remover no ticket 22 (os primitivos técnicos moraram aqui; agora vêm de src/shared/nucleo/primitivos.ts)
export {
  Id,
  Instante,
  Markdown,
  Motivo,
  motivo,
  palavras,
  Slug,
  Titulo,
  unicoPor,
} from "../../../shared/nucleo/primitivos.ts";

// provisório: remover no ticket 22 (o modelo, o effort e o modo de trabalho do agente moraram aqui; agora vêm de Sessões)
export { Effort, Modelo, ModoTrabalho } from "../../sessoes/publico.ts";

// Os estados do ticket, do motor; os da demanda e da rodada saem do catálogo de Etapas (`sdlc/nucleo/ciclo_de_vida/ciclos.ts`).
export const EstadoTicket = z.enum(["aberto", "em_execucao", "concluido", "falhou", "cancelado"]);

export type EstadoTicket = z.infer<typeof EstadoTicket>;

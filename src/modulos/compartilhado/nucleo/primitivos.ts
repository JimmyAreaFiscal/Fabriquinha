// Primitivos do domínio (F1 §3.1), que não são do shared. Fonte única: o schema gera o tipo e valida em runtime (D2).
import { z } from "zod";
import { Slug } from "../../../shared/nucleo/primitivos.ts";

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

// Os níveis de `pi --thinking`.
export const Effort = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
/** O modelo do agente é sempre o par inteiro: provedor e nome vêm juntos, ou não há modelo. */
export const Modelo = z.object({ provedor: Slug, nome: z.string().trim().min(1).max(200) });
/** Como o agente trabalha: sozinho até o fim, conversando com o Auditor, ou só lendo (sem ferramentas de escrita). */
export const ModoTrabalho = z.enum(["autonomo", "interativo", "consulta"]);
// Os estados do ticket, do motor; os da demanda e da rodada saem do catálogo de Etapas (`sdlc/nucleo/ciclo_de_vida/ciclos.ts`).
export const EstadoTicket = z.enum(["aberto", "em_execucao", "concluido", "falhou", "cancelado"]);

export type Effort = z.infer<typeof Effort>;
export type Modelo = z.infer<typeof Modelo>;
export type ModoTrabalho = z.infer<typeof ModoTrabalho>;
export type EstadoTicket = z.infer<typeof EstadoTicket>;

// Primitivos do domínio (F1 §3.1). Fonte única: o schema gera o tipo e valida em runtime (D2).
import { z } from "zod";

// As mensagens do zod em português, como o resto da Fabriquinha: o web as mostra ao lado de cada campo (F7 §4.4).
z.config(z.locales.ptBR());

export const palavras = (texto: string): number => texto.match(/\S+/g)?.length ?? 0;

/** Para `.refine` de listas: o campo `campo` não se repete entre os itens. */
export const unicoPor =
  <C extends string>(campo: C) =>
  (itens: readonly Record<C, unknown>[]): boolean =>
    new Set(itens.map((item) => item[campo])).size === itens.length;

export const Id = z.number().int().positive();
export const Instante = z.iso.datetime({ offset: true });
export const Titulo = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\n]*$/, "título ocupa uma linha só");
export const Markdown = z.string().refine((t) => palavras(t) <= 1000, "texto excede 1.000 palavras");
export const Motivo = z.string().trim().min(1).max(2000);
/**
 * Um erro qualquer como `Motivo`, cortado em 2.000 caracteres: C6 e C8 nunca recusam a falha, e a execução nunca
 * fica `em_andamento` para sempre.
 */
export const motivo = (texto: string): string => Motivo.catch("falha sem mensagem").parse(texto.slice(0, 2000));
export const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "use letras minúsculas, números e hífen, começando por letra ou número (até 64)");

// Os níveis de `pi --thinking`.
export const Effort = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
// Estados SDLC (comparacao-sdlc-implementacao.md §2.1, D01); independentes entre si.
export const EstadoDemanda = z.enum([
  "entender_e_desenhar",
  "gate_demanda",
  "planejar",
  "gate_planejamento",
  "em_execucao",
  "revisar_demanda",
  "encerrar_demanda",
  "concluida",
  "arquivada",
  "cancelada",
]);
export const EstadoRodada = z.enum([
  "implementar",
  "revisar_rodada",
  "encerrar_rodada",
  "gate_pr",
  "ajustar_resultado",
  "concluida",
]);
export const EtapaTicket = z.enum([
  "entender_e_desenhar",
  "planejar",
  "implementar",
  "revisar_rodada",
  "encerrar_rodada",
  "ajustar_resultado",
  "revisar_demanda",
  "encerrar_demanda",
  "resolver_conflito",
]);
export const EstadoTicket = z.enum(["aberto", "em_execucao", "concluido", "falhou", "cancelado"]);

// Cada tipo tem a sua sequência de IDs (F2 §3.4); o contexto dos comandos entrega `novoId(tipo)`.
export const TipoId = z.enum(["demanda"]);

export type Id = z.infer<typeof Id>;
export type Instante = z.infer<typeof Instante>;
export type Effort = z.infer<typeof Effort>;
export type TipoId = z.infer<typeof TipoId>;
export type EstadoDemanda = z.infer<typeof EstadoDemanda>;
export type EstadoRodada = z.infer<typeof EstadoRodada>;
export type EtapaTicket = z.infer<typeof EtapaTicket>;
export type EstadoTicket = z.infer<typeof EstadoTicket>;

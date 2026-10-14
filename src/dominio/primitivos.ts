// Primitivos do domínio (F1 §3.1). Fonte única: o schema gera o tipo e valida em runtime (D2).
import { z } from "zod";

// As mensagens do zod em português, como o resto da Fabriquinha: o web as mostra ao lado de cada campo (F7 §4.4).
z.config(z.locales.ptBR());

const palavras = (texto: string): number => texto.match(/\S+/g)?.length ?? 0;

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
export const Modelo = z.object({
  provedor: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  modelo: z.string().trim().min(1).max(200),
});

export const Etapa = z.enum(["registro", "desenho", "desenvolvimento", "revisao", "encerramento", "sessao"]);
export const Fase = z.enum([
  "registro",
  "desenho",
  "aprovacao_desenho",
  "desenvolvimento",
  "revisao",
  "encerramento",
  "aprovacao_pr",
  "ajuste_pr",
  "concluida",
]);

// Cada tipo tem a sua sequência de IDs (F2 §3.4); o contexto dos comandos entrega `novoId(tipo)`.
export const TipoId = z.enum(["issue", "ticket", "execucao", "decisao", "evidencia", "proposta"]);

export type Id = z.infer<typeof Id>;
export type Instante = z.infer<typeof Instante>;
export type Modelo = z.infer<typeof Modelo>;
export type Etapa = z.infer<typeof Etapa>;
export type Fase = z.infer<typeof Fase>;
export type TipoId = z.infer<typeof TipoId>;

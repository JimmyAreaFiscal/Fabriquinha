// Primitivos do domínio (F1 §3.1). Fonte única: o schema gera o tipo e valida em runtime (D2).
import { z } from "zod";

const palavras = (texto: string): number => texto.match(/\S+/g)?.length ?? 0;

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
export const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
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
export const TipoId = z.enum(["issue", "ticket", "execucao", "decisao", "evidencia"]);

export type Id = z.infer<typeof Id>;
export type Instante = z.infer<typeof Instante>;
export type Modelo = z.infer<typeof Modelo>;
export type Etapa = z.infer<typeof Etapa>;
export type Fase = z.infer<typeof Fase>;
export type TipoId = z.infer<typeof TipoId>;

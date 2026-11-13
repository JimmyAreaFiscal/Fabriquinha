import assert from "node:assert/strict";
import { test } from "node:test";
import type { z } from "zod";
import { Id, Instante, Markdown, Motivo, Slug, Titulo } from "./primitivos.ts";

const aceita = (schema: z.ZodType, ...valores: unknown[]) => {
  for (const v of valores) assert.ok(schema.safeParse(v).success, `deveria aceitar ${JSON.stringify(v)}`);
};
const recusa = (schema: z.ZodType, ...valores: unknown[]) => {
  for (const v of valores) assert.ok(!schema.safeParse(v).success, `deveria recusar ${JSON.stringify(v)}`);
};

test("Id é inteiro positivo", () => {
  aceita(Id, 1, 42);
  recusa(Id, 0, -1, 1.5, "1", null);
});

test("Instante é ISO 8601 com fuso", () => {
  aceita(Instante, new Date(0).toISOString(), "2026-10-11T12:00:00-03:00");
  recusa(Instante, "2026-10-11", "2026-10-11T12:00:00", "ontem");
});

test("Titulo tem de 1 a 120 caracteres numa linha só, sem espaço nas pontas", () => {
  assert.equal(Titulo.parse("  Corrigir login  "), "Corrigir login");
  aceita(Titulo, "a".repeat(120));
  recusa(Titulo, "", "   ", "a".repeat(121), "duas\nlinhas");
  const erro = Titulo.safeParse("duas\nlinhas").error;
  assert.equal(erro?.issues[0]?.message, "título ocupa uma linha só");
});

test("Markdown aceita até 1.000 palavras", () => {
  aceita(Markdown, "", "# Título\n\n" + "palavra ".repeat(998), "palavra\n\t".repeat(1000));
  recusa(Markdown, "palavra ".repeat(1001));
  assert.equal(Markdown.safeParse("p ".repeat(1001)).error?.issues[0]?.message, "texto excede 1.000 palavras");
});

test("Motivo tem de 1 a 2.000 caracteres sem contar espaço nas pontas", () => {
  aceita(Motivo, "falta o caso de erro", "x".repeat(2000));
  recusa(Motivo, "", "  ", "x".repeat(2001));
});

test("Slug é minúsculo, com dígitos e hífen, até 64 caracteres", () => {
  aceita(Slug, "fabriquinha", "a", "0-projeto-2", "a".repeat(64));
  recusa(Slug, "", "-inicio", "Maiuscula", "com espaco", "com_sublinhado", "a".repeat(65));
});

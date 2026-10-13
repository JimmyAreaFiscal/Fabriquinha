import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { NomeDoAnexo, NovoUsuarioSimulado } from "./simulacao.ts";

const erros = (schema: z.ZodType, entrada: unknown): string[] =>
  schema.safeParse(entrada).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];

test("NovoUsuarioSimulado apara o nome e a descrição", () => {
  assert.deepEqual(NovoUsuarioSimulado.parse({ nome: "  Dona Maria ", descricao: " Contadora de 60 anos\n" }), {
    nome: "Dona Maria",
    descricao: "Contadora de 60 anos",
  });
});

test("NovoUsuarioSimulado dá a mensagem de cada campo obrigatório e respeita os tetos", () => {
  assert.deepEqual(erros(NovoUsuarioSimulado, { nome: "Seu João", descricao: "" }), [
    "descricao: Descrição obrigatória",
  ]);
  assert.deepEqual(erros(NovoUsuarioSimulado, { nome: "   ", descricao: "  " }), [
    "nome: Nome obrigatório",
    "descricao: Descrição obrigatória",
  ]);
  assert.deepEqual(erros(NovoUsuarioSimulado, { nome: "n".repeat(80), descricao: "d".repeat(4000) }), []);
  assert.equal(erros(NovoUsuarioSimulado, { nome: "n".repeat(81), descricao: "d" }).length, 1);
  assert.equal(erros(NovoUsuarioSimulado, { nome: "n", descricao: "d".repeat(4001) }).length, 1);
  assert.equal(erros(NovoUsuarioSimulado, { nome: "n", descricao: "d", extra: 1 }).length, 1);
});

test("NomeDoAnexo aceita PDF, texto e imagem, em qualquer caixa", () => {
  for (const nome of ["manual.pdf", "a.txt", "a.md", "a.csv", "a.png", "a.jpg", "a.jpeg", "a.webp", "a.gif", "M.PDF"]) {
    assert.equal(NomeDoAnexo.parse(nome), nome);
  }
  assert.equal(NomeDoAnexo.parse(`${"a".repeat(196)}.pdf`).length, 200);
});

test("NomeDoAnexo recusa formato fora da lista, nome vazio, longo, com / ou caractere de controle", () => {
  const formato = "formato não suportado: envie PDF, texto ou imagem";
  for (const nome of ["planilha.xlsx", "sem-extensao", "..", ".pdf.exe", "arquivo."]) {
    assert.deepEqual(erros(NomeDoAnexo, nome), [`: ${formato}`], nome);
  }
  assert.equal(erros(NomeDoAnexo, "").length, 2); // vazio: o tamanho e o formato
  assert.equal(erros(NomeDoAnexo, `${"a".repeat(197)}.pdf`).length, 1);
  const barra = "o nome do arquivo não pode ter / nem caracteres de controle";
  assert.ok(erros(NomeDoAnexo, "../manual.pdf").includes(`: ${barra}`));
  assert.ok(erros(NomeDoAnexo, "pasta/manual.pdf").includes(`: ${barra}`));
  assert.ok(erros(NomeDoAnexo, "man\nual.pdf").includes(`: ${barra}`));
});

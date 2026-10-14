import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  LINK_FORA_DO_AR,
  NomeDoAnexo,
  NovaTarefa,
  NovoUsuarioSimulado,
  RelatorioSimulacao,
  SEM_LINK,
  StatusExecucaoSimulada,
} from "./simulacao.ts";

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

test("NovaTarefa apara o texto e dá a mensagem de cada campo", () => {
  assert.deepEqual(NovaTarefa.parse({ texto: "  Registrar uma necessidade ", n: 3, usuarios: [1, 2] }), {
    texto: "Registrar uma necessidade",
    n: 3,
    usuarios: [1, 2],
  });
  assert.deepEqual(erros(NovaTarefa, { texto: " ", n: 3, usuarios: [1] }), ["texto: Tarefa obrigatória"]);
  assert.deepEqual(erros(NovaTarefa, { texto: "t", n: 3, usuarios: [] }), [
    "usuarios: Aloque ao menos um usuário simulado",
  ]);
});

test("NovaTarefa aceita N de 1 a 20 inteiro; o resto dá a mensagem de N", () => {
  for (const n of [1, 20]) assert.deepEqual(erros(NovaTarefa, { texto: "t", n, usuarios: [1] }), []);
  for (const n of [0, -1, 2.5, "3", null]) {
    assert.deepEqual(erros(NovaTarefa, { texto: "t", n, usuarios: [1] }), ["n: N deve ser um inteiro maior que zero"]);
  }
  assert.deepEqual(erros(NovaTarefa, { texto: "t", n: 21, usuarios: [1] }), ["n: N passa de 20"]);
});

test("NovaTarefa respeita o teto do texto e recusa campo desconhecido e usuário que não é ID", () => {
  assert.deepEqual(erros(NovaTarefa, { texto: "t".repeat(2000), n: 1, usuarios: [1] }), []);
  assert.equal(erros(NovaTarefa, { texto: "t".repeat(2001), n: 1, usuarios: [1] }).length, 1);
  assert.equal(erros(NovaTarefa, { texto: "t", n: 1, usuarios: [1], extra: 1 }).length, 1);
  assert.equal(erros(NovaTarefa, { texto: "t", n: 1, usuarios: [0] }).length, 1);
});

test("StatusExecucaoSimulada tem os quatro estados e as mensagens são as dos CAs", () => {
  assert.deepEqual(StatusExecucaoSimulada.options, ["na_fila", "em_andamento", "concluida", "falhou"]);
  assert.equal(SEM_LINK, "Informe o link do produto na Configuração do projeto");
  assert.equal(LINK_FORA_DO_AR, "Não foi possível abrir o link do produto");
});

test("RelatorioSimulacao aceita seções vazias e até 50 achados de 1 a 2000 caracteres", () => {
  assert.deepEqual(erros(RelatorioSimulacao, { usabilidade: [], bugs: [] }), []);
  const cheio = { usabilidade: Array.from({ length: 50 }, () => "x".repeat(2000)), bugs: ["b"] };
  assert.deepEqual(erros(RelatorioSimulacao, cheio), []);
  assert.equal(erros(RelatorioSimulacao, { usabilidade: Array.from({ length: 51 }, () => "x"), bugs: [] }).length, 1);
  assert.equal(erros(RelatorioSimulacao, { usabilidade: ["x".repeat(2001)], bugs: [] }).length, 1);
  assert.equal(erros(RelatorioSimulacao, { usabilidade: [""], bugs: [] }).length, 1);
  assert.equal(erros(RelatorioSimulacao, { usabilidade: [] }).length, 1);
  assert.equal(erros(RelatorioSimulacao, { usabilidade: [1], bugs: [] }).length, 1);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfiguracaoEtapaProjeto, Projeto } from "./configuracao_projeto.ts";
import { Projeto as ProjetoLegado } from "./projeto.ts";

const valido = {
  nome: "fabriquinha",
  branch_base: "main",
  chave_sonarqube: "Fabriquinha",
  raiz_git: "/home/x/fabriquinha",
  hospedagem: "github",
  fitness: [{ nome: "dominio-sem-io", comando: "npm run fitness", descricao: "o domínio não faz I/O" }],
  linguagens: [{ caminho: ".", linguagem: "typescript", comando_teste: "npm test" }],
};
const e2e = {
  caminho_linguagem: ".",
  comando_build: "npm run build",
  comando_execucao: "npm run e2e",
  codigo_falha: 1,
};
const glob = { caminho_linguagem: ".", glob: "e2e/**/*.ts" };
const aceita = (extra: object) => Projeto.safeParse({ ...valido, ...extra }).success;

test("CA-1: projeto válido; mesma linguagem em caminhos diferentes; legado intacto", () => {
  assert.ok(aceita({ cursor_commit_humano: "abc" }));
  assert.ok(aceita({ linguagens: [...valido.linguagens, { ...valido.linguagens[0], caminho: "web" }] }));
  assert.equal(ProjetoLegado.safeParse(valido).success, false);
});

test("CA-2: recusa sem linguagens, caminho absoluto ou com ..", () => {
  const com = (caminho: string) => [{ ...valido.linguagens[0], caminho }];
  assert.ok(!aceita({ linguagens: [] }));
  for (const c of ["/abs", "\\abs", "C:\\abs", "c:/abs", "a/../b", "..\\b"])
    assert.ok(!aceita({ linguagens: com(c) }), c);
  assert.ok(aceita({ linguagens: com("a..b/c") }));
});

test("CA-3 e CA-4: preparação preserva a ordem informada e recusa repetição", () => {
  const preparacao = [
    { ordem: 2, comando: "b" },
    { ordem: 1, comando: "a" },
  ];
  assert.deepEqual(Projeto.parse({ ...valido, preparacao }).preparacao, preparacao);
  assert.ok(!aceita({ preparacao: [...preparacao, { ordem: 1, comando: "c" }] }));
  assert.ok(!aceita({ preparacao: [{ ordem: 1, comando: " " }] }));
  assert.ok(!aceita({ etapas: [{ etapa: "planejar" }, { etapa: "planejar" }] }));
  assert.ok(!aceita({ fitness: [...valido.fitness, ...valido.fitness] }));
  assert.ok(!aceita({ linguagens: [...valido.linguagens, ...valido.linguagens] }));
});

test("CA-5 e CA-6: modelo em par e effort do enum", () => {
  const ok = (c: object) => ConfiguracaoEtapaProjeto.safeParse({ etapa: "implementar", ...c }).success;
  assert.ok(ok({}));
  assert.ok(ok({ modelo_provedor: "qualquer", modelo_nome: "desconhecido" }));
  assert.ok(ok({ effort: "max" }));
  assert.ok(!ok({ modelo_provedor: "openai" }));
  assert.ok(!ok({ modelo_nome: "gpt" }));
  assert.ok(!ok({ effort: "altissimo" }));
  assert.ok(aceita({ etapas: [{ etapa: "implementar", effort: "low" }] }));
});

test("CA-7: exige ao menos uma fitness function", () => {
  assert.ok(!aceita({ fitness: [] }));
});

test("CA-8: E2E com globs é aceito", () => {
  assert.ok(aceita({ e2e: [e2e], globs: [glob] }));
});

test("CA-9: recusa E2E órfão, glob órfão, glob inválido, código fora de 1–255 e repetições", () => {
  assert.ok(!aceita({ e2e: [{ ...e2e, caminho_linguagem: "outro" }], globs: [glob] }));
  assert.ok(!aceita({ globs: [glob] }));
  assert.ok(!aceita({ e2e: [e2e] }));
  assert.ok(!aceita({ e2e: [e2e, e2e], globs: [glob] }));
  assert.ok(!aceita({ e2e: [e2e], globs: [glob, glob] }));
  assert.ok(!aceita({ e2e: [e2e], globs: [{ ...glob, glob: "/x/*" }] }));
  assert.ok(!aceita({ e2e: [e2e], globs: [{ ...glob, glob: "../x/*" }] }));
  for (const codigo_falha of [0, 256]) assert.ok(!aceita({ e2e: [{ ...e2e, codigo_falha }], globs: [glob] }));
  assert.ok(aceita({ e2e: [{ ...e2e, codigo_falha: 255 }], globs: [glob] }));
});

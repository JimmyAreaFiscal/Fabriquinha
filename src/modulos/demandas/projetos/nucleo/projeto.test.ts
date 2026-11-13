import assert from "node:assert/strict";
import { test } from "node:test";
import { ComandosDePreparacao, Projeto, ProjetoConfigurado } from "./projeto.ts";

const cadastro = {
  nome: "fabriquinha",
  raiz_git: "/home/auditor/fabriquinha",
  branch_base: "main",
  hospedagem: "github",
  chave_sonarqube: "Fabriquinha",
};
const verificacoes = {
  fitness: [{ nome: "dominio-sem-io", comando: "npm run fitness", descricao: "o domínio não faz I/O" }],
  linguagens: [{ caminho: ".", linguagem: "typescript", comando_teste: "npm test" }],
};
const configurado = { ...cadastro, verificacoes };
const configuracaoE2e = {
  caminho_linguagem: ".",
  comando_build: "npm run build",
  comando_execucao: "npm run e2e",
  codigo_falha: 1,
};
const globE2e = { caminho_linguagem: ".", glob: "e2e/**/*.ts" };
const aceitaVerificacoes = (alteracoes: object) =>
  ProjetoConfigurado.safeParse({ ...configurado, verificacoes: { ...verificacoes, ...alteracoes } }).success;
const erros = (entrada: unknown) =>
  Projeto.safeParse(entrada).error?.issues.map((ocorrencia) => `${ocorrencia.path.join(".")}: ${ocorrencia.message}`) ??
  [];

test("Projeto mínimo válido ganha etapas e verificações vazias", () => {
  assert.deepEqual(Projeto.parse(cadastro), {
    ...cadastro,
    etapas: [],
    verificacoes: { preparacao: [], fitness: [], linguagens: [], e2e: [], globs: [] },
  });
  assert.deepEqual(Projeto.parse({ ...cadastro, verificacoes: {} }).verificacoes, {
    preparacao: [],
    fitness: [],
    linguagens: [],
    e2e: [],
    globs: [],
  });
});

test("Projeto aceita preparação; os campos do fluxo legado são rejeitados", () => {
  const completo = Projeto.parse({ ...cadastro, hospedagem: "azure-devops", verificacoes: { preparacao: ["npm ci"] } });
  assert.deepEqual(completo.verificacoes.preparacao, ["npm ci"]);
  assert.equal(completo.hospedagem, "azure-devops");
  for (const campoLegado of ["testes", "fitness", "modelos", "efforts"])
    assert.equal(Projeto.safeParse({ ...cadastro, [campoLegado]: [] }).success, false, campoLegado);
  // O link do produto era da Simulação, que saiu (ticket 02).
  assert.equal(Projeto.safeParse({ ...cadastro, link_produto: "https://produto.exemplo.com" }).success, false);
});

test("Projeto recusa cada campo fora da regra, com o caminho do campo", () => {
  const casos: [Record<string, unknown>, string][] = [
    [{ nome: "Com Espaco" }, "nome"],
    [{ raiz_git: "relativo/repo" }, "raiz_git: caminho absoluto"],
    [{ branch_base: "" }, "branch_base"],
    [{ hospedagem: "gitlab" }, "hospedagem"],
    [{ verificacoes: { preparacao: ["  "] } }, "verificacoes.preparacao.0"],
    [{ chave_sonarqube: "" }, "chave_sonarqube"],
    [{ chave_sonarqube: undefined }, "chave_sonarqube"],
  ];
  for (const [alteracao, esperado] of casos) {
    const mensagens = erros({ ...cadastro, ...alteracao });
    assert.ok(
      mensagens.some((mensagem) => mensagem.startsWith(esperado)),
      JSON.stringify(mensagens),
    );
  }
});

test("CA-1: projeto configurado válido; mesma linguagem em caminhos diferentes; campos estranhos rejeitados", () => {
  assert.ok(aceitaVerificacoes({}));
  assert.equal(ProjetoConfigurado.safeParse({ ...configurado, cursor_commit_humano: "abc" }).success, false);
  assert.ok(
    aceitaVerificacoes({ linguagens: [...verificacoes.linguagens, { ...verificacoes.linguagens[0], caminho: "web" }] }),
  );
  assert.equal(ProjetoConfigurado.safeParse(cadastro).success, false);
});

test("CA-2: recusa sem linguagens, caminho absoluto ou com ..", () => {
  assert.ok(!aceitaVerificacoes({ linguagens: [] }));
  for (const caminho of ["/abs", "\\abs", "C:\\abs", "c:/abs", "a/../b", "..\\b"])
    assert.ok(!aceitaVerificacoes({ linguagens: [{ ...verificacoes.linguagens[0], caminho }] }), caminho);
  assert.ok(aceitaVerificacoes({ linguagens: [{ ...verificacoes.linguagens[0], caminho: "a..b/c" }] }));
});

test("CA-3 e CA-4: preparação preserva a ordem informada; etapas e chaves repetidas são rejeitadas", () => {
  assert.deepEqual(ComandosDePreparacao.parse([" b ", "a", "b"]), ["b", "a", "b"]);
  assert.deepEqual(ComandosDePreparacao.parse(undefined), []);
  assert.ok(!aceitaVerificacoes({ preparacao: [" "] }));
  assert.ok(!aceitaVerificacoes({ preparacao: [{ ordem: 1, comando: "a" }] }));
  assert.deepEqual(erros({ ...cadastro, etapas: [{ etapa: "planejar" }, { etapa: "planejar" }] }), [
    "etapas: etapa repetida",
  ]);
  for (const [campo, repetidas] of Object.entries({
    fitness: [...verificacoes.fitness, ...verificacoes.fitness],
    linguagens: [...verificacoes.linguagens, ...verificacoes.linguagens],
  })) {
    const resultado = Projeto.safeParse({ ...cadastro, verificacoes: { ...verificacoes, [campo]: repetidas } });
    assert.equal(resultado.success, false);
    assert.deepEqual(resultado.error.issues[0]?.path, ["verificacoes", campo]);
  }
});

test("CA-5 e CA-6: modelo em par e effort do enum", () => {
  const aceitaAgente = (configuracao_agente: object) =>
    Projeto.safeParse({ ...cadastro, etapas: [{ etapa: "implementar", configuracao_agente }] }).success;
  assert.ok(aceitaAgente({}));
  assert.ok(aceitaAgente({ modelo: { provedor: "qualquer", nome: "desconhecido" } }));
  assert.ok(aceitaAgente({ effort: "max" }));
  assert.ok(!aceitaAgente({ modelo: { provedor: "openai" } }));
  assert.ok(!aceitaAgente({ modelo: { nome: "gpt" } }));
  assert.ok(!aceitaAgente({ effort: "altissimo" }));
  assert.ok(aceitaAgente({ effort: "low" }));
});

test("CA-7: ProjetoConfigurado exige fitness e linguagens; Projeto não exige mínimos", () => {
  assert.ok(!aceitaVerificacoes({ fitness: [] }));
  assert.ok(!aceitaVerificacoes({ fitness: undefined }));
  assert.ok(!aceitaVerificacoes({ linguagens: undefined }));
  assert.ok(Projeto.safeParse({ ...cadastro, verificacoes: { fitness: [], linguagens: [] } }).success);
});

test("CA-8: E2E com globs é aceito", () => {
  assert.ok(aceitaVerificacoes({ e2e: [configuracaoE2e], globs: [globE2e] }));
});

test("CA-9: recusa E2E órfão, glob órfão, glob inválido, código fora de 1–255 e repetições", () => {
  const inconsistencias: [object, string][] = [
    [{ e2e: [{ ...configuracaoE2e, caminho_linguagem: "outro" }], globs: [globE2e] }, "e2e"],
    [{ globs: [globE2e] }, "globs"],
    [{ e2e: [configuracaoE2e] }, "e2e"],
    [{ e2e: [configuracaoE2e, configuracaoE2e], globs: [globE2e] }, "e2e"],
    [{ e2e: [configuracaoE2e], globs: [globE2e, globE2e] }, "globs"],
  ];
  for (const [alteracao, campo] of inconsistencias) {
    assert.ok(!aceitaVerificacoes(alteracao));
    const resultado = ProjetoConfigurado.safeParse({ ...configurado, verificacoes: { ...verificacoes, ...alteracao } });
    assert.deepEqual(resultado.error?.issues[0]?.path, ["verificacoes", campo]);
  }
  for (const glob of ["/x/*", "../x/*"])
    assert.ok(!aceitaVerificacoes({ e2e: [configuracaoE2e], globs: [{ ...globE2e, glob }] }));
  for (const codigo_falha of [0, 256])
    assert.ok(!aceitaVerificacoes({ e2e: [{ ...configuracaoE2e, codigo_falha }], globs: [globE2e] }));
  assert.ok(aceitaVerificacoes({ e2e: [{ ...configuracaoE2e, codigo_falha: 255 }], globs: [globE2e] }));
});

test("imagem_do_ambiente é opcional e não pode ser vazia", () => {
  assert.equal(Object.hasOwn(Projeto.parse(cadastro), "imagem_do_ambiente"), false);
  assert.equal(Projeto.parse({ ...cadastro, imagem_do_ambiente: "Dockerfile" }).imagem_do_ambiente, "Dockerfile");
  assert.equal(Projeto.safeParse({ ...cadastro, imagem_do_ambiente: "" }).success, false);
});

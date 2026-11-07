import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { migrar } from "./banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const TABELAS_DA_CONFIGURACAO_DO_PROJETO = [
  "configuracao_etapa_projeto",
  "comando_preparacao_projeto",
  "fitness_function_projeto",
  "linguagem_projeto",
  "configuracao_e2e",
  "glob_e2e",
];
const CURSOR_DA_LOJA = "a".repeat(40);
const CURSOR_DO_BLOG_NA_PROJETO = "b".repeat(40);
const CURSOR_DO_BLOG_NA_VARREDURA = "c".repeat(64);
const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 2;

/** Um banco na v38 (`repo`, `sonar_project_key`, `cursor_commit_humano`) com configuração nas seis tabelas. */
function bancoNaVersao38(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, 2));
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key, link_produto, cursor_commit_humano) VALUES
      ('loja', '/r1', 'main', 'github', 'k1', 'http://loja', '${CURSOR_DA_LOJA}'),
      ('site', '/r2', 'develop', 'azure-devops', 'k2', NULL, NULL),
      ('blog', '/r3', 'main', 'github', 'k3', NULL, '${CURSOR_DO_BLOG_NA_PROJETO}');
    INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES ('blog', '${CURSOR_DO_BLOG_NA_VARREDURA}', '2026-01-01T00:00:00.000Z');
    INSERT INTO configuracao_etapa_projeto (projeto, etapa, modelo_provedor, modelo_nome, effort) VALUES
      ('loja', 'planejar', 'anthropic', 'claude', 'high'), ('loja', 'implementar', NULL, NULL, 'low'), ('site', 'entender_e_desenhar', NULL, NULL, NULL);
    INSERT INTO comando_preparacao_projeto (projeto, ordem, comando) VALUES ('loja', 1, 'npm ci'), ('loja', 2, 'npm run build');
    INSERT INTO fitness_function_projeto (projeto, nome, comando, descricao) VALUES ('loja', 'f', 'npm run f', 'd'), ('site', 'g', 'make g', 'e');
    INSERT INTO linguagem_projeto (projeto, caminho, linguagem, comando_teste) VALUES ('loja', '.', 'ts', 'npm test'), ('loja', 'web', 'ts', 'npm t');
    INSERT INTO configuracao_e2e (projeto, caminho_linguagem, comando_build, comando_execucao, codigo_falha) VALUES ('loja', '.', 'b', 'e', 3);
    INSERT INTO glob_e2e (projeto, caminho_linguagem, glob) VALUES ('loja', '.', 'e2e/**'), ('loja', '.', 'x/**');
  `);
  return banco;
}

const linhas = (banco: DatabaseSync, sql: string): unknown[] =>
  banco
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

const configuracaoDoProjeto = (banco: DatabaseSync): unknown[] =>
  TABELAS_DA_CONFIGURACAO_DO_PROJETO.map((tabela) => linhas(banco, `SELECT * FROM ${tabela} ORDER BY rowid`));

const versao = (banco: DatabaseSync): number =>
  (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

test("a migração 39 renomeia as colunas do projeto e deixa as seis tabelas da configuração idênticas", () => {
  const banco = bancoNaVersao38();
  const antes = configuracaoDoProjeto(banco);
  migrar(banco, MIGRACOES);
  assert.equal(versao(banco), VERSAO_ANTES + 1);
  assert.deepEqual(configuracaoDoProjeto(banco), antes);
  assert.deepEqual(linhas(banco, "SELECT * FROM projeto ORDER BY nome"), [
    {
      nome: "blog",
      raiz_git: "/r3",
      branch_base: "main",
      hospedagem: "github",
      chave_sonarqube: "k3",
      link_produto: null,
    },
    {
      nome: "loja",
      raiz_git: "/r1",
      branch_base: "main",
      hospedagem: "github",
      chave_sonarqube: "k1",
      link_produto: "http://loja",
    },
    {
      nome: "site",
      raiz_git: "/r2",
      branch_base: "develop",
      hospedagem: "azure-devops",
      chave_sonarqube: "k2",
      link_produto: null,
    },
  ]);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  banco.close();
});

test("a migração 39 leva o cursor para a varredura, sem trocar o de quem já tem varredura", () => {
  const banco = bancoNaVersao38();
  migrar(banco, MIGRACOES);
  assert.deepEqual(linhas(banco, "SELECT projeto, ultimo_sha, em FROM varredura_base ORDER BY projeto"), [
    { projeto: "blog", ultimo_sha: CURSOR_DO_BLOG_NA_VARREDURA, em: "2026-01-01T00:00:00.000Z" },
    { projeto: "loja", ultimo_sha: CURSOR_DA_LOJA, em: "1970-01-01T00:00:00.000Z" },
  ]);
  banco.close();
});

test("a migração 39 recusa, desfazendo tudo, se uma tabela da configuração mudou de tamanho", () => {
  const banco = bancoNaVersao38();
  banco.exec(`CREATE TRIGGER perde_preparacao AFTER INSERT ON varredura_base
    BEGIN DELETE FROM comando_preparacao_projeto WHERE ordem = 2; END`);
  const antes = configuracaoDoProjeto(banco);
  const projetosAntes = linhas(banco, "SELECT * FROM projeto ORDER BY nome");
  assert.throws(
    () => {
      migrar(banco, MIGRACOES);
    },
    (erro) =>
      erro instanceof ErroDeRegra && erro.message.includes("mudou o número de linhas de comando_preparacao_projeto"),
  );
  assert.equal(versao(banco), VERSAO_ANTES);
  assert.deepEqual(configuracaoDoProjeto(banco), antes);
  assert.deepEqual(linhas(banco, "SELECT * FROM projeto ORDER BY nome"), projetosAntes);
  assert.equal(banco.isTransaction, false);
  banco.close();
});

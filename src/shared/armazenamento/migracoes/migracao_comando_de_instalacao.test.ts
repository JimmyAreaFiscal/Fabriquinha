// A migração 59, de Demandas (banco na versão 58): `npm ci` sai da preparação e vira a instalação do projeto.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrarBancoDaFabriquinha } from "../../../server/system/banco_da_fabriquinha.ts";

test("a migração 59 move o npm ci da preparação para a instalação e mantém a ordem dos demais comandos", () => {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrarBancoDaFabriquinha(banco, 58);
  const inserirProjeto = banco.prepare(
    "INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES (?, ?, 'main', 'github', ?)",
  );
  const inserirComando = banco.prepare(
    "INSERT INTO comando_preparacao_projeto (projeto, ordem, comando) VALUES (?, ?, ?)",
  );
  inserirProjeto.run("com-npm-ci", "/r1", "k1");
  inserirProjeto.run("sem-npm-ci", "/r2", "k2");
  for (const [ordem, comando] of [
    [1, "git config x"],
    [2, "  npm ci "],
    [3, "npm run build"],
  ] as const)
    inserirComando.run("com-npm-ci", ordem, comando);
  for (const [ordem, comando] of [
    [1, "npm ci --ignore-scripts"],
    [2, "npm install"],
  ] as const)
    inserirComando.run("sem-npm-ci", ordem, comando);

  migrarBancoDaFabriquinha(banco);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, 59);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  const comandos = (tabela: string) =>
    banco
      .prepare(`SELECT projeto, comando FROM ${tabela} ORDER BY projeto, ordem`)
      .all()
      .map((l) => ({ ...l }));
  assert.deepEqual(comandos("comando_instalacao_projeto"), [{ projeto: "com-npm-ci", comando: "npm ci" }]);
  assert.deepEqual(comandos("comando_preparacao_projeto"), [
    { projeto: "com-npm-ci", comando: "git config x" },
    { projeto: "com-npm-ci", comando: "npm run build" },
    { projeto: "sem-npm-ci", comando: "npm ci --ignore-scripts" },
    { projeto: "sem-npm-ci", comando: "npm install" },
  ]);
});

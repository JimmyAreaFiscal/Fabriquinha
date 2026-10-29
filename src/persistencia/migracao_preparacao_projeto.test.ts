// A migração que deixa a preparação da worktree numa fonte só (versão 34), sobre um banco montado com o esquema
// anterior: o projeto sem comando em `comando_preparacao_projeto` recebe os da coluna legada, na ordem; o que já tem
// fica como está; e a coluna `projeto.preparacao` sai.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const PREPARACAO_NUMA_FONTE = 34;

const ler = (b: DatabaseSync, sql: string) =>
  b
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

test("copia a preparação legada para a tabela só no projeto sem comando nela e remove a coluna legada", () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, PREPARACAO_NUMA_FONTE - 1));
  b.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, preparacao, sonar_project_key)
      VALUES ('so-no-painel', '/repo/a', 'main', 'github', '["uv venv .venv","uv sync","npm ci"]', 'a'),
             ('nas-duas', '/repo/b', 'main', 'github', '["antigo"]', 'b'),
             ('sem-preparacao', '/repo/c', 'main', 'github', '[]', 'c');
    INSERT INTO comando_preparacao_projeto VALUES ('nas-duas', 1, 'npm ci'), ('nas-duas', 2, 'npm run build');
  `);

  migrar(b, MIGRACOES.slice(0, PREPARACAO_NUMA_FONTE));

  assert.equal(b.prepare("PRAGMA user_version").get()?.user_version, PREPARACAO_NUMA_FONTE);
  assert.deepEqual(ler(b, "SELECT * FROM comando_preparacao_projeto ORDER BY projeto, ordem"), [
    { projeto: "nas-duas", ordem: 1, comando: "npm ci" },
    { projeto: "nas-duas", ordem: 2, comando: "npm run build" },
    { projeto: "so-no-painel", ordem: 1, comando: "uv venv .venv" },
    { projeto: "so-no-painel", ordem: 2, comando: "uv sync" },
    { projeto: "so-no-painel", ordem: 3, comando: "npm ci" },
  ]);
  assert.ok(!ler(b, "PRAGMA table_info(projeto)").some((coluna) => coluna.name === "preparacao"));
  assert.deepEqual(ler(b, "PRAGMA foreign_key_check"), []);
  b.close();
});

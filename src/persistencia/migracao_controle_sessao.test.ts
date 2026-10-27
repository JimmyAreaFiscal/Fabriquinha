import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const V27 = 27;
const T = "'2026-01-01T00:00:00.000Z'";

const versao = (b: DatabaseSync) => (b.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

test("CA-4: v27 com execuções → 28 devolve as execuções iguais, sem os campos novos", () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, V27));
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T});
    INSERT INTO sessao VALUES ('s1', 'I-1', 1, 'autonomo', 'c');
    INSERT INTO execucao_sessao VALUES ('e1', 's1', ${T}, NULL, 0);`);
  const antes = b
    .prepare("SELECT * FROM execucao_sessao")
    .all()
    .map((l) => ({ ...l }));
  migrar(b, MIGRACOES);
  assert.equal(versao(b), V27 + 1);
  const depois = b
    .prepare("SELECT * FROM execucao_sessao")
    .all()
    .map((l) => ({ ...l }));
  assert.deepEqual(depois, [
    { ...antes[0], grupo_processo: null, erro: null, modelo_provedor: null, modelo_nome: null, effort: null },
  ]);
  assert.throws(() => {
    b.exec("UPDATE execucao_sessao SET modelo_provedor = 'x'");
  }, /constraint/i);
  assert.throws(() => {
    b.exec("UPDATE execucao_sessao SET effort = 'turbo'");
  }, /constraint/i);
  assert.throws(() => {
    b.exec("UPDATE configuracao SET limite_paralelismo = 0");
  }, /constraint/i);
});

test("CA-5: banco v29 é recusado sem alteração", () => {
  const b = new DatabaseSync(":memory:");
  migrar(b, MIGRACOES);
  b.exec(`PRAGMA user_version = ${String(MIGRACOES.length + 1)}`);
  assert.throws(() => {
    migrar(b, MIGRACOES);
  }, /atualize a Fabriquinha antes de abrir este banco/);
  assert.equal(versao(b), MIGRACOES.length + 1);
});

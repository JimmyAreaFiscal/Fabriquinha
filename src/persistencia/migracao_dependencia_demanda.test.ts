import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";

test("CA-12: v26 → v27 só acrescenta dependencia_demanda e deixa as linhas existentes idênticas", () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, 26));
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T});`);
  const consultas = [
    "SELECT * FROM projeto",
    "SELECT * FROM demanda",
    "SELECT demanda_id, ticket_id, etapa, status, status_alterado_em FROM ticket_demanda",
  ];
  const ler = () =>
    consultas.map((q) =>
      b
        .prepare(q)
        .all()
        .map((l) => ({ ...l })),
    );
  const antes = ler();
  migrar(b, MIGRACOES.slice(0, 27));
  assert.deepEqual(ler(), antes);
  const colunas = b
    .prepare("PRAGMA table_info(dependencia_demanda)")
    .all()
    .map((c) => c.name);
  assert.deepEqual(colunas, ["demanda_id", "depende_demanda_id"]);
  assert.throws(() => {
    b.exec("INSERT INTO dependencia_demanda VALUES ('I-1', 'I-1')");
  }, /constraint/i);
});

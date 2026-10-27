import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";

test("CA-11: v25 → v26 preenche devolucoes 0 e motivo_falha nulo nos tickets existentes", () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, 25));
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
    INSERT INTO demanda VALUES ('D-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/D-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('D-1', 1, 'implementar', 'falhou', ${T});`);
  const antes = b.prepare("SELECT * FROM ticket_demanda").all();
  migrar(b, MIGRACOES);
  const [linha] = b.prepare("SELECT * FROM ticket_demanda").all();
  assert.deepEqual({ ...linha }, { ...antes[0], devolucoes: 0, motivo_falha: null });
  assert.throws(() => {
    b.exec("UPDATE ticket_demanda SET devolucoes = 3");
  });
  assert.throws(() => {
    b.exec("UPDATE ticket_demanda SET motivo_falha = ''");
  });
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const SHA = "a".repeat(40);

test("CA-12: v28 → v29 deixa dados e esquema legados idênticos e as constraints novas recusam o inválido", () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, 28));
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO demanda VALUES ('I-2', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-2');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T}), ('I-1', 2, 'implementar', 'aberto', ${T}),
             ('I-2', 1, 'implementar', 'aberto', ${T});`);
  const tabelas = ["commit_ticket", "arquivo_commit", "retrabalho"];
  const ler = () =>
    tabelas.map((t) => ({
      dados: b
        .prepare(`SELECT * FROM ${t}`)
        .all()
        .map((l) => ({ ...l })),
      esquema: b
        .prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? ORDER BY name")
        .all(t)
        .map((l) => ({ ...l })),
    }));
  const antes = ler();
  migrar(b, MIGRACOES.slice(0, 32)); // o esquema anterior à remoção do fluxo legado, com retrabalho legado
  assert.deepEqual(ler(), antes);

  const recusa = (sql: string) => {
    assert.throws(() => {
      b.exec(sql);
    }, /constraint/i);
  };
  b.exec(`INSERT INTO commit_ticket_demanda VALUES ('${SHA}', 'I-1', 1, 'm', ${T})`);
  recusa(`INSERT INTO arquivo_commit_demanda VALUES ('${SHA}', 'b.ts', NULL, 'R', 1, 1)`);
  recusa(`INSERT INTO retrabalho_demanda VALUES ('${SHA}', 'I-1', NULL, NULL, 1, 1, NULL)`);
  recusa(`INSERT INTO retrabalho_demanda VALUES ('${SHA}', 'I-1', 1, NULL, 9, 1, 'I-1')`);
  recusa(`INSERT INTO retrabalho_demanda VALUES ('${SHA}', 'I-1', 2, NULL, 1, 1, 'I-1')
    , ('${"b".repeat(40)}', 'I-1', 1, NULL, 1, 1, 'I-1')`);
  const b2 = "b".repeat(40);
  b.exec(`INSERT INTO retrabalho_demanda VALUES ('${b2}', 'I-1', 1, NULL, 2, 1, 'I-2')`);
  recusa(`INSERT INTO retrabalho_demanda VALUES ('${SHA}', 'I-1', 1, NULL, 2, 1, 'I-9')`);
  recusa(`INSERT INTO retrabalho_demanda VALUES ('${SHA}', 'I-1', 1, 'Ana', 2, 1, 'I-1')`);
  recusa(`INSERT INTO retrabalho_demanda VALUES ('${SHA}', 'I-1', NULL, 'Ana', 1, 1, 'I-1')`);
  recusa(`INSERT INTO commit_ticket_demanda VALUES ('${"c".repeat(40)}', 'I-2', 9, 'm', ${T})`);
});

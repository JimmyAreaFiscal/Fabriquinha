import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const SHA = "a".repeat(40);

test("v30 → v31 só acrescenta (linhas e colunas existentes idênticas) e as constraints novas recusam o inválido", () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, 30));
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T}), ('I-1', 2, 'implementar', 'aberto', ${T});
    INSERT INTO commit_ticket_demanda VALUES ('${SHA}', 'I-1', 1, 'm', ${T});
    INSERT INTO retrabalho_demanda VALUES ('${SHA}', 'I-1', 2, NULL, 1, 3);
    INSERT INTO retrabalho_demanda VALUES ('${"b".repeat(40)}', 'I-1', NULL, 'Ana', 1, 2);
    INSERT INTO decisao_ticket VALUES ('I-1', 1, 1, 'aprovado', NULL, NULL, 'auditor', ${T});
    INSERT INTO evidencia_demanda VALUES ('ev', 'I-1', NULL, NULL, 'pr_aberto', '{}', ${T});`);
  const ler = (sql: string) =>
    b
      .prepare(sql)
      .all()
      .map((l) => ({ ...l }));
  const antes = {
    ticket: ler("SELECT demanda_id, ticket_id, etapa, status, status_alterado_em FROM ticket_demanda"),
    demanda: ler("SELECT * FROM demanda"),
    decisao: ler("SELECT * FROM decisao_ticket"),
    evidencia: ler("SELECT * FROM evidencia_demanda"),
    retrabalho: ler(
      "SELECT commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas FROM retrabalho_demanda",
    ),
  };
  migrar(b, MIGRACOES);
  assert.deepEqual(
    ler("SELECT demanda_id, ticket_id, etapa, status, status_alterado_em FROM ticket_demanda"),
    antes.ticket,
  );
  assert.deepEqual(ler("SELECT * FROM demanda"), antes.demanda);
  assert.deepEqual(ler("SELECT * FROM decisao_ticket"), antes.decisao);
  assert.deepEqual(ler("SELECT * FROM evidencia_demanda"), antes.evidencia);
  assert.deepEqual(
    ler("SELECT commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas FROM retrabalho_demanda"),
    antes.retrabalho,
  );
  assert.deepEqual(ler("SELECT ticket_id, alterador_demanda_id FROM retrabalho_demanda ORDER BY rowid"), [
    { ticket_id: 2, alterador_demanda_id: "I-1" },
    { ticket_id: null, alterador_demanda_id: null },
  ]);
  assert.deepEqual(ler("SELECT criado_em, concluido_em, enviado_em, origem, origem_ticket_id FROM ticket_demanda")[0], {
    criado_em: null,
    concluido_em: null,
    enviado_em: null,
    origem: null,
    origem_ticket_id: null,
  });

  const recusa = (sql: string) => {
    assert.throws(() => {
      b.exec(sql);
    }, /constraint/i);
  };
  recusa("UPDATE ticket_demanda SET origem = 'x'");
  b.exec("UPDATE ticket_demanda SET origem = 'agente', origem_ticket_id = 1");
  b.exec(`INSERT INTO demanda_historico VALUES ('I-1', ${T}, NULL, NULL, NULL)`);
  recusa(`INSERT INTO demanda_historico VALUES ('I-9', ${T}, NULL, NULL, NULL)`);
  recusa("INSERT INTO demanda_historico (demanda_id) VALUES ('I-1')");
  b.exec("INSERT INTO decisao_ticket_historico VALUES ('I-1', 1, 1, 'pr')");
  recusa("INSERT INTO decisao_ticket_historico VALUES ('I-1', 1, 1, 'pr')");
  recusa("INSERT INTO decisao_ticket_historico VALUES ('I-1', 1, 2, 'pr')");
  recusa("INSERT INTO decisao_ticket_historico VALUES ('I-1', 1, 1, 'x')");
  b.exec("INSERT INTO evidencia_historico VALUES ('ev', 1, 'agente')");
  recusa("INSERT INTO evidencia_historico VALUES ('ev2', 1, 'agente')");
  recusa("INSERT INTO evidencia_historico VALUES ('ev', 2, 'agente')");
  recusa("INSERT INTO evidencia_historico VALUES ('ev', 1, 'auditor')");
  recusa("INSERT INTO uso_modelo_historico VALUES ('E-1', 'p', 'm', 1)");
  b.exec("DELETE FROM evidencia_demanda");
  assert.equal(ler("SELECT 1 FROM evidencia_historico").length, 0);
});

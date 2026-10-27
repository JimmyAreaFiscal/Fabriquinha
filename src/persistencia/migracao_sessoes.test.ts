import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const NOVAS = [
  "encerramento_demanda",
  "execucao_sessao",
  "limpeza_pendente_encerramento",
  "sessao",
  "uso_modelo_execucao",
];

const versao = (b: DatabaseSync) => (b.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const fotografia = (b: DatabaseSync) =>
  b
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((t) => [String(t.name), JSON.stringify(b.prepare(`SELECT * FROM "${String(t.name)}"`).all())]);

// Demanda D-1 com os tickets 1 e 2; D-2 com o ticket 5.
const DADOS = `
  INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
    VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
  INSERT INTO demanda VALUES ('D-1', 'p', 't', 'problema', 'd', 'encerramento', ${T}, 'f', 's', 1, 'fabriquinha/D-1'),
    ('D-2', 'p', 't', 'problema', 'd', 'encerramento', ${T}, 'f', 's', 1, 'fabriquinha/D-2');
  INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES
    ('D-1', 1, 'implementar', 'aberto', ${T}), ('D-2', 5, 'implementar', 'aberto', ${T});`;

const real = (): DatabaseSync => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, 24));
  b.exec(DADOS);
  return b;
};
const banco = (): DatabaseSync => {
  const b = real();
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO encerramento_demanda (demanda_id, branch, base) VALUES ('D-1', 'b', 'main');
    INSERT INTO limpeza_pendente_encerramento VALUES ('D-1', 'branch-a');
    INSERT INTO sessao VALUES ('s1', 'D-1', 1, 'autonomo', 'c');
    INSERT INTO execucao_sessao VALUES ('e1', 's1', ${T}, NULL, 0);
    INSERT INTO uso_modelo_execucao VALUES ('e1', 'p', 'm', 1, 1, 1, 1, NULL);`);
  return b;
};
const recusa = (sql: string, padrao: RegExp) => {
  assert.throws(() => {
    banco().exec(sql);
  }, padrao);
};

test("CA-16: migrar v24 → v25 só acrescenta as tabelas novas", () => {
  assert.equal(MIGRACOES.length, 25);
  const b = real();
  const antes = fotografia(b);
  assert.equal(versao(b), 24);
  migrar(b, MIGRACOES);
  assert.equal(versao(b), 25);
  assert.deepEqual(
    fotografia(b).filter(([t]) => !NOVAS.includes(String(t))),
    antes,
  );
  assert.deepEqual(
    fotografia(b)
      .map(([t]) => String(t))
      .filter((t) => !antes.some(([a]) => a === t)),
    NOVAS,
  );
  assert.deepEqual(b.prepare("PRAGMA foreign_key_check").all(), []);
});

test("CA-3, CA-4, CA-5, CA-7: progresso do encerramento", () => {
  recusa("INSERT INTO encerramento_demanda (demanda_id, branch, base) VALUES ('D-1', 'b', 'main')", /constraint/i);
  recusa("INSERT INTO encerramento_demanda (demanda_id, branch, base) VALUES ('D-9', 'b', 'main')", /FOREIGN KEY/);
  recusa(
    "INSERT INTO encerramento_demanda (demanda_id, branch, base, conflito_ticket_id) VALUES ('D-2', 'b', 'main', 1)",
    /FOREIGN KEY/,
  );
  recusa("INSERT INTO limpeza_pendente_encerramento VALUES ('D-1', 'branch-a')", /PRIMARY KEY|UNIQUE/);
  recusa("INSERT INTO limpeza_pendente_encerramento VALUES ('D-2', 'x')", /FOREIGN KEY/);
  recusa("UPDATE encerramento_demanda SET pr_numero = 1", /CHECK/);
  recusa("UPDATE encerramento_demanda SET integracao_sha = 'x'", /CHECK/);
  recusa("UPDATE encerramento_demanda SET falha_etapa = 'outra', falha_motivo = 'm'", /CHECK/);
});

test("CA-10, CA-11, CA-13: sessões, execuções e usos", () => {
  recusa("INSERT INTO sessao VALUES ('s2', 'D-1', 99, 'autonomo', 'c')", /FOREIGN KEY/);
  recusa("INSERT INTO sessao VALUES ('s2', 'D-1', 5, 'autonomo', 'c')", /FOREIGN KEY/);
  recusa("INSERT INTO sessao VALUES ('s2', 'D-1', 1, 'outro', 'c')", /CHECK/);
  recusa(`INSERT INTO execucao_sessao VALUES ('e2', 'nao', ${T}, NULL, 0)`, /FOREIGN KEY/);
  recusa("INSERT INTO uso_modelo_execucao VALUES ('e1', 'p', 'm', 1, 1, 1, 1, NULL)", /PRIMARY KEY|UNIQUE/);
  recusa("INSERT INTO uso_modelo_execucao VALUES ('e1', 'p', 'n', 1, -1, 1, 1, NULL)", /CHECK/);
  recusa("INSERT INTO uso_modelo_execucao VALUES ('e1', 'p', 'n', 1, 1, 1, 1, -0.1)", /CHECK/);
  recusa("INSERT INTO uso_modelo_execucao VALUES ('nao', 'p', 'n', 1, 1, 1, 1, NULL)", /FOREIGN KEY/);
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";

test("CA-1 e CA-2: v29 → v30 preserva as evidências e os índices, amplia o CHECK e cria as tabelas novas", () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, 29));
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO evidencia_demanda (id, demanda_id, tipo, dados, em) VALUES
      ('e1', 'I-1', 'custos_realizados', '{"a":1}', ${T}),
      ('e2', 'I-1', 'plano', '{"b":2}', ${T}),
      ('e3', 'I-1', 'comportamento', '{}', ${T});`);
  assert.throws(() => {
    b.exec(`INSERT INTO evidencia_demanda (id, demanda_id, tipo, em) VALUES ('x', 'I-1', 'testes_estresse', ${T})`);
  }, /constraint/i);
  const ler = () =>
    b
      .prepare("SELECT * FROM evidencia_demanda ORDER BY rowid")
      .all()
      .map((l) => ({ ...l }));
  const antes = ler();
  migrar(b, MIGRACOES);
  assert.equal(antes.length, 3);
  assert.deepEqual(ler(), antes);
  const indices = b
    .prepare("SELECT name FROM pragma_index_list('evidencia_demanda') WHERE origin = 'c' ORDER BY name")
    .all()
    .map((i) => i.name);
  assert.deepEqual(indices, [
    "ux_evidencia_demanda_demanda",
    "ux_evidencia_demanda_rodada",
    "ux_evidencia_demanda_ticket",
  ]);
  assert.throws(() => {
    b.exec(`INSERT INTO evidencia_demanda (id, demanda_id, tipo, em) VALUES ('d', 'I-1', 'plano', ${T})`);
  }, /constraint/i);
  b.exec(`INSERT INTO evidencia_demanda (id, demanda_id, tipo, em) VALUES ('n', 'I-1', 'testes_estresse', ${T})`);
  const chave = (t: string) =>
    b
      .prepare(`SELECT name FROM pragma_table_info('${t}') WHERE pk > 0 ORDER BY pk`)
      .all()
      .map((c) => c.name);
  assert.deepEqual(chave("arquivo_evidencia"), ["evidencia_id", "ordem"]);
  assert.deepEqual(chave("sessao_externa_demanda"), ["ferramenta", "sessao"]);
  const colunas = b
    .prepare("SELECT name FROM pragma_table_info('arquivo_evidencia')")
    .all()
    .map((c) => c.name);
  assert.deepEqual(colunas, ["evidencia_id", "ordem", "caminho", "sha256", "mime", "bytes"]);
});

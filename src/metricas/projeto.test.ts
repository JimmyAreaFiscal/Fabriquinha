import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeInexistente } from "../dominio/erros.ts";
import { migrar } from "../persistencia/banco.ts";
import { MIGRACOES } from "../persistencia/migracoes.ts";
import { metricasDaDemanda } from "./demanda.ts";
import { metricasDoProjeto } from "./projeto.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const EM = "2026-01-01T00:00:00.000Z";

/** Duas demandas do projeto p; cada uma com um ticket implementar e um encerrar_rodada na rodada 1. */
const banco = () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
    VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]'), ('vazio', '/repo/v', 'main', 'github', '["t"]', 'k2', '[{"nome":"f"}]')`);
  for (const d of ["I-1", "I-2"]) {
    b.exec(`INSERT INTO demanda VALUES ('${d}', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'b${d}')`);
    b.exec(`INSERT INTO rodada VALUES ('${d}', 1, 'r', 'desenvolvimento', 0, 'br')`);
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id, devolucoes)
      VALUES ('${d}', 1, 'implementar', 'concluido', ${T}, 1, 1), ('${d}', 2, 'encerrar_rodada', 'concluido', ${T}, 1, 0)`);
  }
  return b;
};

const execucao = (b: DatabaseSync, d: string, falha: number, custo: number | null) => {
  b.prepare("INSERT INTO sessao VALUES (?, ?, 1, 'autonomo', 'conv')").run(`s${d}`, d);
  b.prepare("INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES (?, ?, ?, ?, ?)").run(
    `e${d}`,
    `s${d}`,
    EM,
    EM,
    falha,
  );
  b.prepare("INSERT INTO uso_modelo_execucao VALUES (?, 'anthropic', 'm1', 10, 20, 30, 40, ?)").run(`e${d}`, custo);
};
const decisao = (b: DatabaseSync, d: string, resultado: string, nota: number | null) =>
  b.prepare("INSERT INTO decisao_ticket VALUES (?, 2, 1, ?, ?, NULL, 'auditor', ?)").run(d, resultado, nota, EM);
const custos = (b: DatabaseSync, d: string, sessao: string, custo: number | null) =>
  b
    .prepare("INSERT INTO evidencia_demanda (id, demanda_id, tipo, dados, em) VALUES (?, ?, 'custos_realizados', ?, ?)")
    .run(
      `c${d}`,
      d,
      JSON.stringify({ sessoes: [{ ferramenta: "codex", sessao, linhas: [custo === null ? {} : { custo }] }] }),
      EM,
    );

test("CA-16: tokens, execuções, falhas, devoluções e reprovações são a soma das demandas", () => {
  const b = banco();
  execucao(b, "I-1", 1, 1);
  execucao(b, "I-2", 0, 2);
  decisao(b, "I-1", "recusado", null);
  const [a, c] = ["I-1", "I-2"].map((d) => metricasDaDemanda(b, d).total);
  const p = metricasDoProjeto(b, "p");
  assert.equal(p.demandas, 2);
  for (const campo of ["execucoes", "falhas", "devolucoes", "reprovacoes"] as const)
    assert.equal(p[campo], (a?.[campo] ?? 0) + (c?.[campo] ?? 0));
  assert.deepEqual([p.execucoes, p.falhas, p.devolucoes, p.reprovacoes], [2, 1, 2, 1]);
  assert.deepEqual(p.modelos, [
    { provedor: "anthropic", modelo: "m1", entrada: 20, saida: 40, cacheLeitura: 60, cacheEscrita: 80, custo: 3 },
  ]);
  assert.deepEqual(p.custo, { conhecido: 3, incompleto: false });
  b.exec("UPDATE uso_modelo_execucao SET custo = NULL WHERE execucao_id = 'eI-2'");
  const incompleto = metricasDoProjeto(b, "p");
  assert.deepEqual(incompleto.custo, { conhecido: 1, incompleto: true });
  assert.equal(incompleto.modelos[0]?.custo, null);
});

test("CA-15: nota média do projeto é soma ÷ quantidade, não média das médias", () => {
  const b = banco();
  decisao(b, "I-1", "aprovado", 4);
  b.prepare("INSERT INTO decisao_ticket VALUES ('I-1', 2, 2, 'aprovado', 5, NULL, 'auditor', ?)").run(EM);
  decisao(b, "I-2", "aprovado", 3);
  assert.deepEqual(metricasDoProjeto(b, "p").nota, { soma: 12, quantidade: 3, media: 4 });
  assert.deepEqual(metricasDoProjeto(b, "vazio").nota, { soma: 0, quantidade: 0, media: null });
});

test("CA-8: a sessão externa vinculada a duas demandas conta uma vez no projeto", () => {
  const b = banco();
  custos(b, "I-1", "a", 5);
  custos(b, "I-2", "a", 5);
  b.exec("INSERT INTO sessao_externa_demanda VALUES ('codex', 'a', 'I-1')");
  assert.deepEqual(metricasDoProjeto(b, "p").custoExterno, { conhecido: 5, incompleto: false, sessoes: 1 });
  b.exec("INSERT INTO sessao_externa_demanda VALUES ('codex', 'b', 'I-2')");
  b.exec("DELETE FROM evidencia_demanda WHERE id = 'cI-2'");
  custos(b, "I-2", "b", null);
  assert.deepEqual(metricasDoProjeto(b, "p").custoExterno, { conhecido: 5, incompleto: true, sessoes: 2 });
});

test("projeto inexistente lança ErroDeInexistente; sem demandas, totais vazios", () => {
  const b = banco();
  assert.throws(() => metricasDoProjeto(b, "nao"), ErroDeInexistente);
  const p = metricasDoProjeto(b, "vazio");
  assert.deepEqual([p.demandas, p.execucoes, p.modelos], [0, 0, []]);
});

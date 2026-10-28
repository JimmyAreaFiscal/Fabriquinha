import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeInexistente } from "../dominio/erros.ts";
import { migrar } from "../persistencia/banco.ts";
import { MIGRACOES } from "../persistencia/migracoes.ts";
import { metricasDaDemanda } from "./demanda.ts";

const T = "'2026-01-01T00:00:00.000Z'";

/**
 * Demanda I-1, rodadas 1 e 2. Tickets: 1 planejar (sem rodada), 2 implementar (r1, 1 devolução),
 * 3 encerrar_rodada (r1), 4 implementar (r2), 5 encerrar_rodada (r2).
 */
const banco = () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
    VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]')`);
  b.exec(
    `INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1')`,
  );
  for (const r of [1, 2])
    b.exec(`INSERT INTO rodada VALUES ('I-1', ${String(r)}, 'r', 'desenvolvimento', 0, 'b${String(r)}')`);
  for (const [n, etapa, rodada, devolucoes] of [
    [1, "planejar", "NULL", 0],
    [2, "implementar", "1", 1],
    [3, "encerrar_rodada", "1", 0],
    [4, "implementar", "2", 0],
    [5, "encerrar_rodada", "2", 0],
  ] as const)
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id, devolucoes)
      VALUES ('I-1', ${String(n)}, '${etapa}', 'concluido', ${T}, ${rodada}, ${String(devolucoes)})`);
  return b;
};

/** Uma sessão do ticket com uma execução por item; `usos` são [modelo, entrada, saída, cache leitura, cache escrita, custo]. */
const execucao = (
  b: DatabaseSync,
  ticket: number,
  id: string,
  falha: 0 | 1,
  usos: [string, number, number, number, number, number | null][] = [],
) => {
  b.prepare("INSERT OR IGNORE INTO sessao VALUES (?, 'I-1', ?, 'autonomo', 'conv')").run(`s${String(ticket)}`, ticket);
  b.prepare("INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES (?, ?, ?, ?, ?)").run(
    id,
    `s${String(ticket)}`,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:01:00.000Z",
    falha,
  );
  for (const [modelo, e, s, cl, ce, custo] of usos)
    b.prepare("INSERT INTO uso_modelo_execucao VALUES (?, 'anthropic', ?, ?, ?, ?, ?, ?)").run(
      id,
      modelo,
      e,
      s,
      cl,
      ce,
      custo,
    );
};
const decisao = (b: DatabaseSync, ticket: number, id: number, resultado: string, nota: number | null) =>
  b
    .prepare("INSERT INTO decisao_ticket VALUES ('I-1', ?, ?, ?, ?, NULL, 'auditor', ?)")
    .run(ticket, id, resultado, nota, "2026-01-01T00:00:00.000Z");

test("CA-1 e CA-18: tokens por modelo na demanda e por etapa, com o custo das execuções", () => {
  const b = banco();
  execucao(b, 2, "e1", 0, [["m1", 10, 20, 30, 40, 1]]);
  execucao(b, 2, "e2", 0, [["m1", 1, 2, 3, 4, 0.5]]);
  execucao(b, 4, "e3", 0, [["m2", 5, 6, 7, 8, 2]]);
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(m.total.modelos, [
    { provedor: "anthropic", modelo: "m1", entrada: 11, saida: 22, cacheLeitura: 33, cacheEscrita: 44, custo: 1.5 },
    { provedor: "anthropic", modelo: "m2", entrada: 5, saida: 6, cacheLeitura: 7, cacheEscrita: 8, custo: 2 },
  ]);
  const implementar = m.total.etapas.implementar;
  assert.ok(implementar);
  assert.deepEqual(implementar.custo, { conhecido: 3.5, incompleto: false });
  assert.deepEqual(
    implementar.modelos.map((x) => [x.modelo, x.entrada]),
    [
      ["m1", 11],
      ["m2", 5],
    ],
  );
  assert.deepEqual(
    m.rodadas[1]?.modelos.map((x) => x.modelo),
    ["m2"],
  );
});

test("CA-2: cada etapa mostra execuções, falhas, devoluções e reprovações", () => {
  const b = banco();
  execucao(b, 1, "e0", 1);
  execucao(b, 2, "e1", 0);
  execucao(b, 2, "e2", 1);
  decisao(b, 2, 1, "recusado", null);
  decisao(b, 1, 1, "recusado", null);
  decisao(b, 1, 2, "aprovado", null);
  const { etapas, execucoes, falhas, devolucoes, reprovacoes } = metricasDaDemanda(b, "I-1").total;
  assert.deepEqual(
    [etapas.planejar, etapas.implementar].map((e) => [e?.execucoes, e?.falhas, e?.devolucoes, e?.reprovacoes]),
    [
      [1, 1, 0, 1],
      [2, 1, 1, 1],
    ],
  );
  assert.deepEqual(etapas.encerrar_rodada?.execucoes, 0);
  assert.deepEqual([execucoes, falhas, devolucoes, reprovacoes], [3, 2, 1, 2]);
});

test("CA-3: rodadas mais o ticket sem rodada somam o total", () => {
  const b = banco();
  execucao(b, 1, "e0", 0, [["m1", 1, 1, 1, 1, 1]]);
  execucao(b, 2, "e1", 1, [["m1", 2, 2, 2, 2, 2]]);
  execucao(b, 4, "e2", 0, [["m1", 4, 4, 4, 4, 4]]);
  decisao(b, 4, 1, "recusado", null);
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(
    m.rodadas.map((r) => r.rodadaId),
    [1, 2],
  );
  for (const campo of ["execucoes", "falhas", "devolucoes", "reprovacoes"] as const)
    assert.equal(
      m.rodadas.reduce((s, r) => s + r[campo], m.semRodada[campo]),
      m.total[campo],
    );
  assert.equal(m.semRodada.modelos[0]?.entrada, 1);
  assert.equal(m.total.modelos[0]?.entrada, 7);
  assert.equal(m.total.custo.conhecido, 7);
});

test("CA-4: execução de sessão retomada aparece uma vez", () => {
  const b = banco();
  execucao(b, 2, "e1", 1, [["m1", 1, 1, 1, 1, 1]]);
  execucao(b, 2, "e2", 0, [["m1", 1, 1, 1, 1, 1]]); // mesma sessão s2, retomada
  assert.equal(metricasDaDemanda(b, "I-1").total.execucoes, 2);
  assert.equal(metricasDaDemanda(b, "I-1").total.modelos[0]?.entrada, 2);
});

test("CA-5 e CA-6: custo incompleto com modelo desconhecido; completo soma os informados", () => {
  const b = banco();
  execucao(b, 2, "e1", 0, [["m1", 1, 1, 1, 1, null]]);
  execucao(b, 2, "e2", 0, [["m2", 1, 1, 1, 1, 2.5]]);
  const { total } = metricasDaDemanda(b, "I-1");
  assert.deepEqual(total.custo, { conhecido: 2.5, incompleto: true });
  assert.deepEqual(
    total.modelos.map((x) => x.custo),
    [null, 2.5],
  );
  execucao(b, 4, "e3", 0, [["m1", 1, 1, 1, 1, 1]]);
  b.exec("UPDATE uso_modelo_execucao SET custo = 1.5 WHERE custo IS NULL");
  const completo = metricasDaDemanda(b, "I-1").total;
  assert.deepEqual(completo.custo, { conhecido: 5, incompleto: false });
  b.exec("UPDATE uso_modelo_execucao SET custo = NULL WHERE execucao_id = 'e3'");
  assert.equal(metricasDaDemanda(b, "I-1").total.modelos[0]?.custo, null);
});

test("CA-7: custo externo em campo próprio, só de sessão cuja dona é a demanda", () => {
  const b = banco();
  b.exec(`INSERT INTO demanda VALUES ('I-2', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'b')`);
  execucao(b, 2, "e1", 0, [["m1", 1, 1, 1, 1, 1]]);
  const linha = (custo: number | null) => ({
    provedor: "openai",
    modelo: "x",
    tokens_entrada: 1,
    tokens_saida: 1,
    tokens_cache_leitura: 0,
    tokens_cache_escrita: 0,
    ...(custo === null ? {} : { custo }),
  });
  const dados = {
    sessoes: [
      { ferramenta: "codex", sessao: "a", linhas: [linha(3), linha(null)] },
      { ferramenta: "codex", sessao: "de-outra", linhas: [linha(100)] },
    ],
  };
  b.prepare(
    "INSERT INTO evidencia_demanda (id, demanda_id, tipo, dados, em) VALUES ('c1', 'I-1', 'custos_realizados', ?, ?)",
  ).run(JSON.stringify(dados), "2026-01-01T00:00:00.000Z");
  b.exec("INSERT INTO sessao_externa_demanda VALUES ('codex', 'a', 'I-1'), ('codex', 'de-outra', 'I-2')");
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(m.custoExterno, { conhecido: 3, incompleto: true, sessoes: 1 });
  assert.deepEqual(m.total.custo, { conhecido: 1, incompleto: false });
});

test("CA-SDLC-24: custo externo de rodada fica na rodada e soma no total externo, fora do custo interno", () => {
  const b = banco();
  const linha = (custo: number) => ({ provedor: "x", modelo: "m", custo });
  const sessao = (s: string, custo: number) => ({ ferramenta: "codex", sessao: s, linhas: [linha(custo)] });
  const grava = (id: string, rodada: string, dados: unknown) => {
    b.exec(`INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, tipo, dados, em)
      VALUES ('${id}', 'I-1', ${rodada}, 'custos_realizados', '${JSON.stringify(dados)}', ${T})`);
  };
  grava("d", "NULL", { sessoes: [sessao("a", 2)] });
  grava("r1", "1", { sessoes: [sessao("b", 7)] });
  b.exec("INSERT INTO sessao_externa_demanda VALUES ('codex', 'a', 'I-1'), ('codex', 'b', 'I-1')");
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(m.rodadas[0]?.custoExterno, { conhecido: 7, incompleto: false, sessoes: 1 });
  assert.deepEqual(m.rodadas[1]?.custoExterno, { conhecido: 0, incompleto: false, sessoes: 0 });
  assert.deepEqual(m.custoExterno, { conhecido: 9, incompleto: false, sessoes: 2 });
  assert.deepEqual(m.rodadas[0].custo, { conhecido: 0, incompleto: false });
});

test("CA-7: evidência de custos malformada ou de ticket não conta linhas", () => {
  const b = banco();
  b.exec("INSERT INTO sessao_externa_demanda VALUES ('codex', 'a', 'I-1')");
  const grava = (id: string, dados: string, rodada: string, ticket: string, tipo = "custos_realizados") => {
    b.exec(`INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em)
      VALUES ('${id}', 'I-1', ${rodada}, ${ticket}, '${tipo}', '${dados}', ${T})`);
  };
  const vazio = { conhecido: 0, incompleto: false, sessoes: 0 };
  grava("c2", '{"sessoes":{"a":1}}', "NULL", "NULL");
  assert.deepEqual(metricasDaDemanda(b, "I-1").custoExterno, vazio);
  b.exec("DELETE FROM evidencia_demanda");
  grava("c3", '{"sessoes":[{"ferramenta":"codex","sessao":"a","linhas":5}]}', "NULL", "NULL");
  assert.deepEqual(metricasDaDemanda(b, "I-1").custoExterno, vazio);
  b.exec("DELETE FROM evidencia_demanda");
  grava("c4", '{"sessoes":[{"ferramenta":"codex","sessao":"a","linhas":[{"custo":9}]}]}', "NULL", "1");
  assert.deepEqual(metricasDaDemanda(b, "I-1").custoExterno, vazio);
});

test("CA-14: média só das notas dos PRs de rodada aprovados com nota", () => {
  const b = banco();
  decisao(b, 3, 1, "aprovado", 4);
  decisao(b, 5, 1, "aprovado", 5);
  decisao(b, 5, 2, "aprovado", null);
  decisao(b, 2, 1, "aprovado", 1); // não é PR de rodada
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(m.total.nota, { soma: 9, quantidade: 2, media: 4.5 });
  assert.deepEqual(m.rodadas[0]?.nota, { soma: 4, quantidade: 1, media: 4 });
  assert.deepEqual(m.semRodada.nota, { soma: 0, quantidade: 0, media: null });
});

test("a rodada traz a conformidade (null sem plano ou commit)", () => {
  assert.equal(metricasDaDemanda(banco(), "I-1").rodadas[0]?.conformidade, null);
});

test("CA-17: demanda inexistente falha, sem totais zerados", () => {
  assert.throws(() => metricasDaDemanda(banco(), "I-9"), ErroDeInexistente);
});

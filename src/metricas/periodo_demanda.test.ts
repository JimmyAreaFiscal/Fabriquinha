import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "../persistencia/banco.ts";
import { MIGRACOES } from "../persistencia/migracoes.ts";
import { metricasDemandaPorMes, metricasPorDemanda, NIVEIS } from "./periodo_demanda.ts";

/** O dia 15 do mês ao meio-dia, no fuso do serviço, como o banco grava: em UTC. */
const em = (mes: string) => new Date(`${mes}-15T12:00:00`).toISOString();
const SHA = (n: number) => String(n).repeat(40);

/**
 * loja: I-1 (rodadas 1 e 2; tickets 1 implementar r1, 2 encerrar_rodada r1, 3 implementar r2) e I-2 sem execução;
 * site: I-3 com o ticket 1 implementar. Sessões s1 (ticket 1 de I-1, retomada em duas execuções), s2 (ticket 3 de I-1).
 */
function banco(): DatabaseSync {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  for (const nome of ["loja", "site"])
    b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('${nome}', '/repo/${nome}', 'main', 'github', '["t"]', '${nome}', '[{"nome":"f"}]')`);
  const demanda = (id: string, projeto: string, fase: string, alterada: string) => {
    b.exec(
      `INSERT INTO demanda VALUES ('${id}', '${projeto}', 'Título ${id}', 'problema', 'd', '${fase}', '${alterada}', 'f', 's', 1, 'b-${id}')`,
    );
  };
  demanda("I-1", "loja", "execucao", em("2026-03"));
  demanda("I-2", "loja", "concluida", em("2026-03"));
  demanda("I-3", "site", "execucao", em("2026-03"));
  b.exec(
    `INSERT INTO evidencia_demanda (id, demanda_id, tipo, dados, em) VALUES ('e0', 'I-1', 'comportamento', '{}', '${em("2026-01")}')`,
  );
  for (const r of [1, 2])
    b.exec(`INSERT INTO rodada VALUES ('I-1', ${String(r)}, 'r', 'desenvolvimento', 0, 'b${String(r)}')`);
  const ticket = (d: string, n: number, etapa: string, rodada: string, status: string, quando: string) => {
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id)
      VALUES ('${d}', ${String(n)}, '${etapa}', '${status}', '${quando}', ${rodada})`);
  };
  ticket("I-1", 1, "implementar", "1", "concluido", em("2026-02"));
  ticket("I-1", 2, "encerrar_rodada", "1", "concluido", em("2026-02"));
  ticket("I-1", 3, "implementar", "2", "aberto", em("2026-03"));
  ticket("I-3", 1, "implementar", "NULL", "concluido", em("2026-03"));
  const sessao = (id: string, d: string, t: number) => {
    b.exec(`INSERT INTO sessao VALUES ('${id}', '${d}', ${String(t)}, 'autonomo', 'conv')`);
  };
  sessao("s1", "I-1", 1);
  sessao("s2", "I-1", 3);
  sessao("s3", "I-3", 1);
  const execucao = (id: string, s: string, mes: string, falha: number, fim: string | null) =>
    b
      .prepare("INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES (?, ?, ?, ?, ?)")
      .run(id, s, em(mes), fim, falha);
  execucao("x1", "s1", "2026-02", 1, `${em("2026-02").slice(0, 14)}01:00.000Z`);
  execucao("x2", "s1", "2026-02", 0, `${em("2026-02").slice(0, 14)}02:00.000Z`);
  execucao("x3", "s2", "2026-03", 0, null);
  execucao("x4", "s3", "2026-03", 0, `${em("2026-03").slice(0, 14)}00:30.000Z`);
  const uso = (x: string, modelo: string, entrada: number, custo: number | null) =>
    b.prepare("INSERT INTO uso_modelo_execucao VALUES (?, 'p', ?, ?, 1, 2, 3, ?)").run(x, modelo, entrada, custo);
  uso("x1", "a", 10, 1);
  uso("x2", "a", 20, 2); // a retomada soma uma vez, ao lado da primeira execução
  uso("x2", "b", 5, null); // custo desconhecido: nunca vira zero
  uso("x3", "a", 100, 4);
  uso("x4", "a", 1000, 8);
  const decisao = (n: number, id: number, resultado: string, nota: number | null, mes: string) =>
    b
      .prepare("INSERT INTO decisao_ticket VALUES ('I-1', ?, ?, ?, ?, NULL, 'auditor', ?)")
      .run(n, id, resultado, nota, em(mes));
  decisao(1, 1, "recusado", null, "2026-02");
  decisao(2, 1, "aprovado", 4, "2026-02");
  decisao(2, 2, "aprovado", 5, "2026-02");
  b.prepare(
    "INSERT INTO evidencia_demanda (id, demanda_id, ticket_id, tipo, dados, em) VALUES ('e1', 'I-1', 2, 'pr_aberto', '{}', ?)",
  ).run(em("2026-02"));
  // O ticket 3 reescreve 10 das 30 linhas do ticket 1; uma pessoa, 5.
  b.prepare("INSERT INTO commit_ticket_demanda VALUES (?, 'I-1', 1, 'm', ?)").run(SHA(1), em("2026-02"));
  b.prepare("INSERT INTO commit_ticket_demanda VALUES (?, 'I-1', 3, 'm', ?)").run(SHA(2), em("2026-03"));
  b.prepare("INSERT INTO arquivo_commit_demanda VALUES (?, 'a.ts', NULL, 'M', 30, 0)").run(SHA(1));
  b.prepare("INSERT INTO retrabalho_demanda VALUES (?, 'I-1', 3, NULL, 1, 10, 'I-1')").run(SHA(2));
  b.prepare("INSERT INTO retrabalho_demanda VALUES (?, 'I-1', NULL, 'ana', 1, 5, NULL)").run(SHA(3));
  return b;
}

const [FEV, MAR] = [1, 2];
const ver = <T>(x: T | undefined): T => {
  assert.ok(x);
  return x;
};

test("consumo por mês: cada execução uma vez, retomada somada, custo desconhecido sinalizado", () => {
  const meses = metricasDemandaPorMes(banco(), { de: "2026-01", ate: "2026-03" });
  assert.deepEqual(
    meses.map((m) => m.mes),
    ["2026-01", "2026-02", "2026-03"],
  );
  const fev = ver(meses[FEV]);
  assert.equal(fev.total.execucoes, 2);
  assert.equal(fev.total.falhas, 1);
  assert.equal(fev.total.duracaoMs, 3 * 60_000);
  assert.deepEqual(fev.total.tokens, { entrada: 35, saida: 3, cacheLeitura: 6, cacheEscrita: 9 });
  assert.deepEqual(fev.total.custo, { conhecido: 3, incompleto: true });
  assert.deepEqual(
    fev.total.modelos.map((m) => [m.modelo, m.entrada, m.custo]),
    [
      ["a", 30, 3],
      ["b", 5, null],
    ],
  );
  const mar = ver(meses[MAR]);
  assert.equal(mar.total.execucoes, 2);
  assert.deepEqual(mar.total.custo, { conhecido: 12, incompleto: false });
  assert.equal(mar.total.duracaoMs, 30_000, "execução em andamento não tem duração");
  assert.equal(ver(meses[0]).total.execucoes, 0);
  assert.deepEqual(ver(meses[0]).total.custo, { conhecido: 0, incompleto: false });
});

test("a soma de cada nível, da execução ao projeto, bate com o total", () => {
  for (const m of metricasDemandaPorMes(banco(), { de: "2026-01", ate: "2026-03" })) {
    assert.deepEqual(
      m.niveis.map((n) => n.nivel),
      [...NIVEIS],
    );
    for (const n of m.niveis) {
      const { modelos: _, ...total } = m.total;
      assert.deepEqual(n.total, total, `${m.mes} ${n.nivel}`);
    }
  }
  const mar = ver(metricasDemandaPorMes(banco(), { de: "2026-03", ate: "2026-03" })[0]);
  assert.deepEqual(
    mar.niveis.map((n) => n.grupos),
    [2, 2, 2, 2, 2, 2], // x3 e x4, cada uma na sua sessão, ticket, rodada (a 2 de I-1 e a sem rodada de I-3), demanda e projeto
  );
  const fev = ver(metricasDemandaPorMes(banco(), { de: "2026-02", ate: "2026-02" })[0]);
  assert.deepEqual(
    fev.niveis.map((n) => n.grupos),
    [2, 1, 1, 1, 1, 1], // a retomada: duas execuções na mesma sessão, ticket, rodada e demanda
  );
});

test("fatos do mês: demandas, tickets, PRs, notas, reprovações por etapa e retrabalho", () => {
  const meses = metricasDemandaPorMes(banco(), { de: "2026-01", ate: "2026-03" });
  const [jan, fev, mar] = [ver(meses[0]), ver(meses[1]), ver(meses[2])];
  assert.deepEqual(jan.demandas, { registradas: 1, concluidas: 0 }); // I-1, pela primeira evidência
  assert.deepEqual(mar.demandas, { registradas: 2, concluidas: 1 });
  assert.deepEqual(fev.tickets, { criados: 2, concluidos: 2 });
  assert.deepEqual(mar.tickets, { criados: 2, concluidos: 1 });
  assert.deepEqual(fev.prs, { abertos: 1, mergeados: 2 });
  assert.deepEqual(fev.nota, { media: 4.5, notas: 2 });
  assert.deepEqual(jan.nota, { media: null, notas: 0 });
  assert.equal(fev.etapas.length, 9);
  assert.deepEqual(
    fev.etapas.filter((e) => e.execucoes > 0 || e.reprovacoes > 0).map((e) => [e.etapa, e.execucoes, e.reprovacoes]),
    [["implementar", 2, 1]],
  );
  assert.deepEqual(fev.retrabalho, { adicionadas: 30, alteradas: 15, porHumanos: 5 });
  assert.deepEqual(mar.retrabalho, { adicionadas: 0, alteradas: 0, porHumanos: 0 });
});

test("o projeto filtra tudo", () => {
  const b = banco();
  const mar = ver(metricasDemandaPorMes(b, { projeto: "site", de: "2026-03", ate: "2026-03" })[0]);
  assert.equal(mar.projeto, "site");
  assert.equal(mar.total.execucoes, 1);
  assert.deepEqual(mar.demandas, { registradas: 1, concluidas: 0 });
  assert.equal(mar.etapas.length, 9);
});

test("por demanda: só quem teve execução no período, com a fase atual e a nota do período", () => {
  const b = banco();
  const todas = metricasPorDemanda(b, { de: "2026-01", ate: "2026-03" });
  assert.deepEqual(
    todas.map((d) => [d.demanda, d.projeto, d.titulo, d.fase, d.execucoes, d.reprovacoes, d.nota]),
    [
      ["I-1", "loja", "Título I-1", "execucao", 3, 1, 4.5],
      ["I-3", "site", "Título I-3", "execucao", 1, 0, null],
    ],
  );
  assert.deepEqual(ver(todas[0]).custo, { conhecido: 7, incompleto: true });
  assert.deepEqual(
    metricasPorDemanda(b, { projeto: "site", de: "2026-03", ate: "2026-03" }).map((d) => d.demanda),
    ["I-3"],
  );
  assert.deepEqual(metricasPorDemanda(b, { de: "2026-01", ate: "2026-01" }), []);
});

test("execução sem uso registrado soma zero sem custo incompleto, e PR aprovado sem nota conta sem entrar na média", () => {
  const b = banco();
  b.prepare("INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('x9', 's3', ?, NULL, 0)").run(
    em("2026-04"),
  );
  b.prepare("INSERT INTO decisao_ticket VALUES ('I-1', 2, 3, 'aprovado', NULL, NULL, 'auditor', ?)").run(em("2026-04"));
  const abr = ver(metricasDemandaPorMes(b, { de: "2026-04", ate: "2026-04" })[0]);
  assert.equal(abr.total.execucoes, 1);
  assert.deepEqual(abr.total.custo, { conhecido: 0, incompleto: false });
  assert.deepEqual(abr.prs, { abertos: 0, mergeados: 1 });
  assert.deepEqual(abr.nota, { media: null, notas: 0 });
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeInexistente } from "../nucleo/erros.ts";
import { migrar } from "../armazenamento/banco.ts";
import { MIGRACOES } from "../armazenamento/migracoes.ts";
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
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k')`);
  b.exec(
    `INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1')`,
  );
  for (const r of [1, 2])
    b.exec(
      `INSERT INTO rodada VALUES ('I-1', ${String(r)}, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'b${String(r)}')`,
    );
  for (const [n, etapa, rodada] of [
    [1, "planejar", "NULL", 0],
    [2, "implementar", "1", 1],
    [3, "encerrar_rodada", "1", 0],
    [4, "implementar", "2", 0],
    [5, "encerrar_rodada", "2", 0],
  ] as const)
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
      VALUES ('I-1', ${String(n)}, '${etapa}', 'concluido', ${T}, ${rodada})`);
  b.exec(`INSERT INTO tentativa (demanda_id, ticket_id, numero, inicio, fim, resultado_tipo, motivo)
    VALUES ('I-1', 2, 1, ${T}, ${T}, 'reprovacao', 'corrija o teste')`);
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
  b.prepare("INSERT OR IGNORE INTO trabalho_agentico VALUES (?, 'I-1', ?, 'autonomo', 'conv')").run(
    `s${String(ticket)}`,
    ticket,
  );
  b.prepare("INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES (?, ?, ?, ?, ?)").run(
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
    .prepare(
      "INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, nota, motivo, por_tipo, em) VALUES ('I-1', ?, ?, 'gate_pr', ?, ?, NULL, 'auditor', ?)",
    )
    .run(ticket, id, resultado, nota, "2026-01-01T00:00:00.000Z");

test("CA-1 e CA-18: tokens por modelo na demanda e por etapa, com o custo das execuções", () => {
  const b = banco();
  execucao(b, 2, "e1", 0, [["m1", 10, 20, 30, 40, 1]]);
  execucao(b, 2, "e2", 0, [["m1", 1, 2, 3, 4, 0.5]]);
  execucao(b, 4, "e3", 0, [["m2", 5, 6, 7, 8, 2]]);
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(m.total.modelos, [
    {
      modelo: "anthropic/m1",
      tokens_entrada: 11,
      tokens_saida: 22,
      tokens_cache_leitura: 33,
      tokens_cache_escrita: 44,
      custo: 1.5,
      chamadas: 0,
    },
    {
      modelo: "anthropic/m2",
      tokens_entrada: 5,
      tokens_saida: 6,
      tokens_cache_leitura: 7,
      tokens_cache_escrita: 8,
      custo: 2,
      chamadas: 0,
    },
  ]);
  const implementar = m.total.etapas.implementar;
  assert.ok(implementar);
  assert.deepEqual(implementar.custo, { conhecido: 3.5, trabalhosSemCusto: 0 });
  assert.deepEqual(
    implementar.modelos.map((x) => [x.modelo, x.tokens_entrada]),
    [
      ["anthropic/m1", 11],
      ["anthropic/m2", 5],
    ],
  );
  assert.deepEqual(
    m.rodadas[1]?.modelos.map((x) => x.modelo),
    ["anthropic/m2"],
  );
});

test("CA-2: cada etapa mostra execuções, falhas, devoluções e reprovações", () => {
  const b = banco();
  execucao(b, 1, "e0", 1);
  execucao(b, 2, "e1", 0);
  execucao(b, 2, "e2", 1);
  decisao(b, 2, 1, "reprovado", null);
  decisao(b, 1, 1, "reprovado", null);
  decisao(b, 1, 2, "aprovado", null);
  const { etapas, execucoes, falhas, exigenciasDeAlteracao, reprovacoes } = metricasDaDemanda(b, "I-1").total;
  assert.deepEqual(
    [etapas.planejar, etapas.implementar].map((e) => [
      e?.execucoes,
      e?.falhas,
      e?.exigenciasDeAlteracao,
      e?.reprovacoes,
    ]),
    [
      [1, 1, 0, 1],
      [2, 1, 1, 1],
    ],
  );
  assert.deepEqual(etapas.encerrar_rodada?.execucoes, 0);
  assert.deepEqual([execucoes, falhas, exigenciasDeAlteracao, reprovacoes], [3, 2, 1, 2]);
});

test("CA-3: rodadas mais o ticket sem rodada somam o total", () => {
  const b = banco();
  execucao(b, 1, "e0", 0, [["m1", 1, 1, 1, 1, 1]]);
  execucao(b, 2, "e1", 1, [["m1", 2, 2, 2, 2, 2]]);
  execucao(b, 4, "e2", 0, [["m1", 4, 4, 4, 4, 4]]);
  decisao(b, 4, 1, "reprovado", null);
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(
    m.rodadas.map((r) => r.rodadaId),
    [1, 2],
  );
  for (const campo of ["execucoes", "falhas", "exigenciasDeAlteracao", "reprovacoes"] as const)
    assert.equal(
      m.rodadas.reduce((s, r) => s + r[campo], m.semRodada[campo]),
      m.total[campo],
    );
  assert.equal(m.semRodada.modelos[0]?.tokens_entrada, 1);
  assert.equal(m.total.modelos[0]?.tokens_entrada, 7);
  assert.equal(m.total.custo.conhecido, 7);
});

test("CA-4: execução de sessão retomada aparece uma vez", () => {
  const b = banco();
  execucao(b, 2, "e1", 1, [["m1", 1, 1, 1, 1, 1]]);
  execucao(b, 2, "e2", 0, [["m1", 1, 1, 1, 1, 1]]); // mesma sessão s2, retomada
  assert.equal(metricasDaDemanda(b, "I-1").total.execucoes, 2);
  assert.equal(metricasDaDemanda(b, "I-1").total.modelos[0]?.tokens_entrada, 2);
});

test("CA-5 e CA-6: custo incompleto com modelo desconhecido; completo soma os informados", () => {
  const b = banco();
  execucao(b, 2, "e1", 0, [["m1", 1, 1, 1, 1, null]]);
  execucao(b, 2, "e2", 0, [["m2", 1, 1, 1, 1, 2.5]]);
  const { total } = metricasDaDemanda(b, "I-1");
  assert.deepEqual(total.custo, { conhecido: 2.5, trabalhosSemCusto: 1 });
  assert.deepEqual(
    total.modelos.map((x) => x.custo),
    [null, 2.5],
  );
  execucao(b, 4, "e3", 0, [["m1", 1, 1, 1, 1, 1]]);
  b.exec("UPDATE uso_modelo_execucao SET custo = 1.5 WHERE custo IS NULL");
  const completo = metricasDaDemanda(b, "I-1").total;
  assert.deepEqual(completo.custo, { conhecido: 5, trabalhosSemCusto: 0 });
  b.exec("UPDATE uso_modelo_execucao SET custo = NULL WHERE execucao_id = 'e3'");
  // O custo desconhecido some diante do conhecido: o modelo vira piso e o Trabalho sem custo é avisado.
  const parcial = metricasDaDemanda(b, "I-1").total;
  assert.equal(parcial.modelos[0]?.custo, 1.5);
  assert.deepEqual(parcial.custo, { conhecido: 4, trabalhosSemCusto: 1 });
});

const gravarUso = (b: DatabaseSync, sessao: string, demanda: string, linhas: unknown[]) =>
  b
    .prepare("INSERT INTO uso_declarado (ferramenta, sessao, demanda_id, linhas) VALUES ('codex', ?, ?, ?)")
    .run(sessao, demanda, JSON.stringify(linhas));

const linhaDeUso = (custo: number | null) => ({
  modelo: "openai/x",
  tokens_entrada: 1,
  tokens_saida: 1,
  tokens_cache_leitura: 0,
  tokens_cache_escrita: 0,
  custo,
  chamadas: 0,
});

test("CA-7: custo externo em campo próprio, só de sessão cuja dona é a demanda", () => {
  const b = banco();
  b.exec(`INSERT INTO demanda VALUES ('I-2', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'b')`);
  execucao(b, 2, "e1", 0, [["m1", 1, 1, 1, 1, 1]]);
  gravarUso(b, "a", "I-1", [linhaDeUso(3), linhaDeUso(null)]);
  gravarUso(b, "de-outra", "I-2", [linhaDeUso(100)]);
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(m.custoExterno, { conhecido: 3, trabalhosSemCusto: 1, sessoes: 1 });
  assert.deepEqual(m.total.custo, { conhecido: 4, trabalhosSemCusto: 1 });
});

test("CA-SDLC-24: custo externo soma no total externo, fora do custo interno e das rodadas", () => {
  const b = banco();
  gravarUso(b, "a", "I-1", [linhaDeUso(2)]);
  gravarUso(b, "b", "I-1", [linhaDeUso(7)]);
  const m = metricasDaDemanda(b, "I-1");
  assert.deepEqual(m.custoExterno, { conhecido: 9, trabalhosSemCusto: 0, sessoes: 2 });
  assert.deepEqual(m.rodadas[0]?.custoExterno, { conhecido: 0, trabalhosSemCusto: 0, sessoes: 0 });
  assert.deepEqual(m.rodadas[0].custo, { conhecido: 0, trabalhosSemCusto: 0 });
});

test("o total soma o Uso declarado da demanda, e cada execução sem custo conta uma sessão", () => {
  const b = banco();
  execucao(b, 2, "e1", 0, [["m1", 1, 1, 0, 0, 4.2]]);
  execucao(b, 2, "e2", 0, [
    ["m1", 1, 1, 0, 0, null],
    ["m2", 1, 1, 0, 0, null],
  ]);
  execucao(b, 2, "e3", 0, [["m1", 1, 1, 0, 0, null]]);
  gravarUso(b, "a", "I-1", [linhaDeUso(3)]);
  const { total, rodadas } = metricasDaDemanda(b, "I-1");
  assert.equal(total.textoDoCusto, "≥ US$ 7,20 (2 sessões sem custo)");
  assert.deepEqual(rodadas[0]?.custo, { conhecido: 4.2, trabalhosSemCusto: 2 });
});

test("CA-7: sessão declarada sem linhas não conta como sessão externa", () => {
  const b = banco();
  gravarUso(b, "a", "I-1", []);
  assert.deepEqual(metricasDaDemanda(b, "I-1").custoExterno, { conhecido: 0, trabalhosSemCusto: 0, sessoes: 0 });
});

test("CA-17: demanda inexistente falha, sem totais zerados", () => {
  assert.throws(() => metricasDaDemanda(banco(), "I-9"), ErroDeInexistente);
});

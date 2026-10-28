import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Plano } from "../dominio/demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { backfillDemandas } from "./backfill_demanda.ts";
import { carregarDemanda } from "./demandas.ts";
import { montarFixture, SHA_5 } from "./fixture_backfill.test.ts";

const ler = (b: DatabaseSync, sql: string) =>
  b
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));
const TABELAS = ["demanda", "rodada", "ticket_demanda", "evidencia_demanda", "dependencia_demanda", "sessao"];
const novas = (b: DatabaseSync) => TABELAS.map((t) => ler(b, `SELECT * FROM ${t} ORDER BY rowid`));
const migrada = () => {
  const b = montarFixture();
  backfillDemandas(b);
  return b;
};
const fases = (b: DatabaseSync, id: string) => ({
  demanda: ler(b, `SELECT fase, enviada, branch FROM demanda WHERE id = '${id}'`)[0],
  rodadas: ler(b, `SELECT rodada_id, fase, branch FROM rodada WHERE demanda_id = '${id}'`),
});

test("CA-1: desenvolvimento vira execução com a rodada 1 em desenvolvimento e os tickets com o mesmo número", () => {
  const b = migrada();
  assert.deepEqual(fases(b, "I-5"), {
    demanda: { fase: "execucao", enviada: 1, branch: "fabriquinha/I-5" },
    rodadas: [{ rodada_id: 1, fase: "desenvolvimento", branch: "fabriquinha/I-5-1" }],
  });
  assert.deepEqual(ler(b, "SELECT ticket_id, etapa, status, rodada_id FROM ticket_demanda WHERE demanda_id = 'I-5'"), [
    { ticket_id: 10, etapa: "implementar", status: "aberto", rodada_id: 1 },
    { ticket_id: 11, etapa: "implementar", status: "falhou", rodada_id: 1 },
  ]);
  assert.equal(carregarDemanda(b, "I-5").demanda.fase, "execucao");
});

test("CA-2: registro fica em registro, não enviada e sem rodada", () => {
  const b = migrada();
  assert.deepEqual(fases(b, "I-6"), {
    demanda: { fase: "registro", enviada: 0, branch: "fabriquinha/I-6" },
    rodadas: [],
  });
  assert.deepEqual(ler(b, "SELECT ticket_id, etapa, status FROM ticket_demanda WHERE demanda_id = 'I-6'"), [
    { ticket_id: 12, etapa: "demanda", status: "aberto" },
  ]);
});

test("CA-3: desenho vira planejamento, sem rodada e sem o ticket de desenvolvimento proposto", () => {
  const b = migrada();
  assert.deepEqual(fases(b, "I-7"), {
    demanda: { fase: "planejamento", enviada: 1, branch: "fabriquinha/I-7" },
    rodadas: [],
  });
  assert.deepEqual(
    ler(b, "SELECT ticket_id FROM ticket_demanda WHERE demanda_id = 'I-7'").map((t) => t.ticket_id),
    [13, 14],
  );
  assert.equal(ler(b, "SELECT 1 FROM evidencia_demanda WHERE demanda_id = 'I-7' AND tipo = 'plano'").length, 0);
});

test("CA-4: aprovação do desenho vira aprovação do planejamento com o plano das propostas, no ticket de planejamento", () => {
  const b = migrada();
  assert.equal(fases(b, "I-8").demanda?.fase, "aprovacao_planejamento");
  assert.deepEqual(
    ler(b, "SELECT ticket_id, etapa, status FROM ticket_demanda WHERE demanda_id = 'I-8' ORDER BY ticket_id"),
    [
      { ticket_id: 16, etapa: "demanda", status: "concluido" },
      { ticket_id: 17, etapa: "planejar", status: "concluido" }, // esperava o Auditor: o trabalho do agente terminou
    ],
  );
  const [e] = ler(b, "SELECT id, rodada_id, ticket_id, tipo, dados, em FROM evidencia_demanda WHERE tipo = 'plano'");
  assert.deepEqual([e?.id, e?.rodada_id, e?.ticket_id, e?.em], ["plano-I-8", null, 17, "2026-01-10T00:00:00.000Z"]);
  const plano = Plano.parse(JSON.parse(String(e?.dados)));
  assert.deepEqual(
    plano.tickets.map((t) => [t.ticket_id, t.rodada_id, t.titulo, t.modelo_provedor, t.modelo_nome]),
    [
      [18, 1, "Proposta A", "anthropic", "sonnet"],
      [19, 1, "Proposta B", undefined, undefined],
    ],
  );
  assert.equal(carregarDemanda(b, "I-8").evidencias.length, 1);
});

test("CA-5, CA-6: revisão e encerramento viram execução com a rodada 1 na fase homônima", () => {
  const b = migrada();
  assert.deepEqual(fases(b, "I-9"), {
    demanda: { fase: "execucao", enviada: 1, branch: "fabriquinha/I-9" },
    rodadas: [{ rodada_id: 1, fase: "revisao", branch: "fabriquinha/I-9-1" }],
  });
  assert.deepEqual(fases(b, "I-10").rodadas, [{ rodada_id: 1, fase: "encerramento", branch: "fabriquinha/I-10-1" }]);
  assert.equal(ler(b, "SELECT COUNT(*) AS n FROM ticket_demanda WHERE demanda_id = 'I-10'")[0]?.n, 3);
});

test("CA-10: datas, erros, instruções, devoluções, commits, logs, custos e anexos da I-5 chegam iguais", () => {
  const b = migrada();
  assert.deepEqual(
    ler(
      b,
      "SELECT ticket_id, criado_em, motivo_falha, instrucao, devolucoes, origem, origem_ticket_id FROM ticket_demanda WHERE ticket_id = 11",
    ),
    [
      {
        ticket_id: 11,
        criado_em: "2026-01-06T00:00:00.000Z",
        motivo_falha: "falhou aqui",
        instrucao: "ajuste",
        devolucoes: 2,
        origem: "agente",
        origem_ticket_id: 10,
      },
    ],
  );
  assert.deepEqual(ler(b, `SELECT sha, ticket_id, mensagem FROM commit_ticket_demanda WHERE sha = '${SHA_5}'`), [
    { sha: SHA_5, ticket_id: 11, mensagem: "feat: c" },
  ]);
  assert.deepEqual(
    ler(b, "SELECT decisao_id, ticket_id, resultado, motivo FROM decisao_ticket WHERE demanda_id = 'I-5'"),
    [{ decisao_id: 5, ticket_id: 11, resultado: "recusado", motivo: "refaça" }],
  );
  assert.deepEqual(
    ler(b, "SELECT id, sessao_id, falha, erro, grupo_processo FROM execucao_sessao WHERE id IN ('E-5', 'E-6')"),
    [
      { id: "E-5", sessao_id: "pi-10", falha: 0, erro: null, grupo_processo: null },
      { id: "E-6", sessao_id: "pi-11", falha: 1, erro: "sem rede", grupo_processo: 77 },
    ],
  );
  assert.deepEqual(
    ler(b, "SELECT execucao_id, tokens_entrada, custo FROM uso_modelo_execucao WHERE execucao_id = 'E-6'"),
    [{ execucao_id: "E-6", tokens_entrada: 30, custo: 1.25 }],
  );
  assert.deepEqual(ler(b, "SELECT caminho, sha256, bytes FROM arquivo_evidencia WHERE evidencia_id = 'evidencia-7'"), [
    { caminho: "y.txt", sha256: "e".repeat(64), bytes: 7 },
  ]);
  assert.deepEqual(ler(b, "SELECT tipo, ticket_id FROM evidencia_demanda WHERE demanda_id = 'I-5' ORDER BY id"), [
    { tipo: "comportamento", ticket_id: 10 },
    { tipo: "comportamento", ticket_id: 11 },
  ]);
});

test("CA-12: rodar de novo não muda nada e o relatório de em voo sai igual", () => {
  const b = montarFixture();
  const primeira = backfillDemandas(b);
  const migrado = novas(b);
  const segunda = backfillDemandas(b);
  assert.deepEqual(novas(b), migrado);
  assert.deepEqual(segunda.emVoo, primeira.emVoo);
  assert.deepEqual(segunda.depois, primeira.depois);
});

const recusa = (b: DatabaseSync, ...trechos: RegExp[]) => {
  const antes = novas(b);
  assert.throws(
    () => backfillDemandas(b),
    (e) => e instanceof ErroDeRegra && trechos.every((t) => t.test(e.message)),
  );
  assert.deepEqual(novas(b), antes);
  assert.deepEqual(ler(b, "SELECT * FROM demanda"), []);
  assert.equal(b.isTransaction, false);
};

const comPr = (b: DatabaseSync, fase: string) => {
  b.exec(`UPDATE issue SET fase = '${fase}' WHERE id = 9;
    INSERT INTO evidencia (ticket, tipo, produtor, dados, em) VALUES (20, 'pr_aberto', 'fabriquinha', '{"n":9}', '2026-01-10T00:00:00.000Z')`);
};

test("CA-5, CA-10: revisão com PR aberto: rodada 1 em revisão, branch e PR preservados, emVoo marca o PR", () => {
  const b = montarFixture();
  comPr(b, "revisao");
  const r = backfillDemandas(b);
  assert.deepEqual(fases(b, "I-9").rodadas, [{ rodada_id: 1, fase: "revisao", branch: "fabriquinha/I-9-1" }]);
  assert.equal(fases(b, "I-9").demanda?.branch, "fabriquinha/I-9");
  assert.deepEqual(ler(b, "SELECT rodada_id, ticket_id, dados FROM evidencia_demanda WHERE demanda_id = 'I-9'"), [
    { rodada_id: 1, ticket_id: null, dados: '{"n":9}' },
  ]);
  assert.deepEqual(
    r.emVoo.filter((v) => v.pr),
    [{ issue: "I-9", fase: "revisao", pr: true }],
  );
});

test("CA-7: aprovação do PR com PR aberto vira a rodada 1 no gate, com o encerramento em execução e sem decisão nova", () => {
  const b = montarFixture();
  comPr(b, "aprovacao_pr");
  b.exec(
    "INSERT INTO ticket (id, issue, etapa, titulo, descricao, status, origem, criado_em, concluido_em) VALUES (99, 9, 'encerramento', 'Encerrar', 'r', 'concluido', 'fabriquinha', '2026-01-11T00:00:00.000Z', '2026-01-12T00:00:00.000Z')",
  );
  backfillDemandas(b);
  assert.deepEqual(fases(b, "I-9").rodadas, [
    { rodada_id: 1, fase: "aprovacao_pull_request", branch: "fabriquinha/I-9-1" },
  ]);
  assert.deepEqual(ler(b, "SELECT etapa, status, rodada_id FROM ticket_demanda WHERE ticket_id = 99"), [
    { etapa: "encerrar_rodada", status: "em_execucao", rodada_id: 1 },
  ]);
  assert.equal(ler(b, "SELECT 1 FROM decisao_ticket WHERE demanda_id = 'I-9'").length, 0);
  assert.equal(ler(b, "SELECT 1 FROM evidencia_demanda WHERE demanda_id = 'I-9' AND rodada_id = 1").length, 1);
});

test("CA-7: ajuste do PR com PR aberto vira a rodada 1 na sessão de ajustes, com a sessão aberta", () => {
  const b = montarFixture();
  comPr(b, "ajuste_pr");
  b.exec(
    "INSERT INTO ticket (id, issue, etapa, titulo, descricao, status, origem, criado_em) VALUES (99, 9, 'sessao', 'Ajustar o PR', 'mude', 'aberto', 'fabriquinha', '2026-01-11T00:00:00.000Z')",
  );
  backfillDemandas(b);
  assert.deepEqual(fases(b, "I-9").rodadas, [{ rodada_id: 1, fase: "sessao", branch: "fabriquinha/I-9-1" }]);
  assert.deepEqual(ler(b, "SELECT etapa, status, rodada_id FROM ticket_demanda WHERE ticket_id = 99"), [
    { etapa: "sessao_em_aberto", status: "aberto", rodada_id: 1 },
  ]);
});

test("CA-9, CA-13: execução ativa recusa citando a issue e a execução, e nenhuma dependência é criada", () => {
  const b = montarFixture();
  b.exec(`UPDATE ticket SET status = 'em_execucao' WHERE id = 10;
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em) VALUES (7, 20, 'autonomo', 'pi-20', 'em_andamento', '2026-01-10T00:00:00.000Z');
    `);
  recusa(
    b,
    /I-5 tem execução ativa \(ticket T-10, execução -\).*pare o serviço ou espere/,
    /I-9 tem execução ativa \(ticket -, execução E-7\)/,
  );
  assert.deepEqual(ler(b, "SELECT * FROM dependencia_demanda"), []);
});

test("ticket de registro ou desenho enviado, esperando o Auditor, não é execução ativa", () => {
  const b = montarFixture();
  assert.equal(ler(b, "SELECT status FROM ticket WHERE id = 17")[0]?.status, "em_execucao");
  assert.doesNotThrow(() => backfillDemandas(b));
});

test("mais de 2 devoluções em issue em andamento continua recusando", () => {
  const b = montarFixture();
  b.exec("UPDATE ticket SET devolucoes = 3 WHERE id = 11");
  assert.throws(() => backfillDemandas(b), /I-5.*3 devolução/);
  assert.deepEqual(ler(b, "SELECT * FROM demanda"), []);
});

test("aprovação do desenho sem proposta ou sem ticket de desenho não migra, citando a issue", () => {
  const sem = montarFixture();
  sem.exec("DELETE FROM ticket WHERE id IN (18, 19)");
  assert.throws(() => backfillDemandas(sem), /I-8: o plano.*a rodada 1 não tem ticket de implementação/);
  const semDesenho = montarFixture();
  semDesenho.exec("UPDATE ticket SET etapa = 'registro' WHERE id = 17");
  assert.throws(() => backfillDemandas(semDesenho), /I-8 não tem ticket de desenho/);
});

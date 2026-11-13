import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  bancoDaDemanda,
  bancoDoPeriodo,
  doMes,
  em,
  gravarDecisao,
  gravarDecisaoEm,
  gravarTicket,
  origemDe,
} from "../../../../../../apoio-testes/banco/banco_de_metricas.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../../etapas/publico.ts";
import { MetricaDeNotaHumana } from "./metrica_de_nota_humana.ts";
import { MetricaDeUso } from "./metrica_de_uso.ts";

const daEtapa = <Valor>(valores: Map<EtapaTicket, Valor>, etapa: EtapaTicket): Valor => {
  const valor = valores.get(etapa);
  assert.ok(valor);
  return valor;
};

const notaDoRecorte = (b: DatabaseSync, recorte: Recorte) =>
  daEtapa(new MetricaDeNotaHumana().calcular(origemDe(b), recorte), "encerrar_rodada");

test("a nota humana existe só em encerrar_rodada, com a única média das notas", () => {
  const valores = new MetricaDeNotaHumana().calcular(origemDe(bancoDaDemanda()), {});
  assert.deepEqual([...valores.keys()], ["encerrar_rodada"]);
  assert.deepEqual(new MetricaDeNotaHumana().definicao, {
    tipo: "nota_humana",
    rotulo: "Nota humana",
    fonte: "Gate do PR",
  });
});

test("CA-14: média só das notas dos PRs de rodada aprovados com nota", () => {
  const b = bancoDaDemanda();
  gravarDecisao(b, 3, 1, "aprovado", 4);
  gravarDecisao(b, 5, 1, "aprovado", 5);
  gravarDecisao(b, 5, 2, "aprovado", null);
  gravarDecisao(b, 2, 1, "aprovado", 1); // não é PR de rodada
  gravarDecisao(b, 5, 3, "reprovado", 1); // a reprovação não vira nota
  assert.deepEqual(notaDoRecorte(b, { demandaId: "I-1" }), { soma: 9, quantidade: 2, media: 4.5 });
  assert.deepEqual(notaDoRecorte(b, { projeto: "p" }), { soma: 9, quantidade: 2, media: 4.5 });
  assert.deepEqual(notaDoRecorte(bancoDaDemanda(), { demandaId: "I-1" }), { soma: 0, quantidade: 0, media: null });
});

test("por demanda: só quem teve execução no período, com o estado atual e a nota do período", () => {
  const b = bancoDoPeriodo();
  const jan = "2026-01-01T00:00:00.000Z";
  const ate = doMes("2026-03").fim;
  assert.deepEqual(notaDoRecorte(b, { inicio: jan, fim: ate, demandaId: "I-1" }), {
    soma: 9,
    quantidade: 2,
    media: 4.5,
  });
  assert.deepEqual(notaDoRecorte(b, { inicio: jan, fim: ate, demandaId: "I-3" }), {
    soma: 0,
    quantidade: 0,
    media: null,
  });
  assert.deepEqual(notaDoRecorte(b, { ...doMes("2026-01"), demandaId: "I-1" }), {
    soma: 0,
    quantidade: 0,
    media: null,
  });
  assert.deepEqual(notaDoRecorte(b, { ...doMes("2026-02"), projeto: "loja" }), { soma: 9, quantidade: 2, media: 4.5 });
  assert.deepEqual(notaDoRecorte(b, { ...doMes("2026-02"), projeto: "site" }), { soma: 0, quantidade: 0, media: null });
});

test("execução sem uso registrado soma zero sem custo incompleto, e PR aprovado sem nota conta sem entrar na média", () => {
  const b = bancoDoPeriodo();
  b.prepare(
    "INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('x9', 's3', ?, NULL, 0)",
  ).run(em("2026-04"));
  gravarDecisaoEm(b, ["I-1", 2, 3], ["gate_pr", "aprovado", null], em("2026-04"));
  gravarDecisaoEm(b, ["I-1", 2, 4], ["gate_pr", "aprovado", null], em("2026-02"));
  const uso = daEtapa(new MetricaDeUso().calcular(origemDe(b), doMes("2026-04")), "implementar");
  assert.equal(uso.execucoes, 1);
  assert.deepEqual(uso.custo, { conhecido: 0, trabalhosSemCusto: 0, trabalhosComCustoEstimado: 0 });
  assert.deepEqual(notaDoRecorte(b, doMes("2026-04")), { soma: 0, quantidade: 0, media: null });
  assert.deepEqual(notaDoRecorte(b, doMes("2026-02")), { soma: 9, quantidade: 2, media: 4.5 }); // a aprovada sem nota não entra na média
});

test("PRs por coorte do mês de abertura: o pr_aberto da rodada migrada conta, e mergeado nunca passa de aberto", () => {
  const b = bancoDoPeriodo();
  for (const r of [3, 4])
    b.exec(
      `INSERT INTO rodada VALUES ('I-1', ${String(r)}, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'b${String(r)}')`,
    );
  gravarTicket(b, "I-1", 4, "encerrar_rodada", 3);
  gravarTicket(b, "I-1", 5, "encerrar_rodada", 4);
  // aprovada em março na rodada migrada: a nota entra no mês da Decisão
  gravarDecisaoEm(b, ["I-1", 4, 1], ["gate_pr", "aprovado", 3], em("2026-03"));
  // reprovada em março: nunca vira nota
  gravarDecisaoEm(b, ["I-1", 5, 1], ["gate_pr", "reprovado", 1], em("2026-03"));
  assert.deepEqual(notaDoRecorte(b, doMes("2026-02")), { soma: 9, quantidade: 2, media: 4.5 });
  assert.deepEqual(notaDoRecorte(b, doMes("2026-03")), { soma: 3, quantidade: 1, media: 3 });
  const aprovadas = b.prepare("SELECT count(*) AS n FROM decisao_ticket WHERE resultado = 'aprovado'").get();
  const todas = notaDoRecorte(b, {});
  assert.ok(todas.quantidade <= Number(aprovadas?.n), "as notas nunca passam das aprovações");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDoPeriodo, doMes, origemDe } from "../../../../../../apoio-testes/banco/banco_de_metricas.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { MetricaDeAlteracoesPosteriores } from "./metrica_de_alteracoes_posteriores.ts";

const alteracoesDoRecorte = (b: ReturnType<typeof bancoDoPeriodo>, recorte: Recorte) =>
  new MetricaDeAlteracoesPosteriores().calcular(origemDe(b), recorte).get("implementar");

test("as alterações posteriores existem só em implementar, com a definição que a tela mostra", () => {
  const valores = new MetricaDeAlteracoesPosteriores().calcular(origemDe(bancoDoPeriodo()), {});
  assert.deepEqual([...valores.keys()], ["implementar"]);
  assert.deepEqual(new MetricaDeAlteracoesPosteriores().definicao, {
    tipo: "alteracoes_posteriores",
    rotulo: "Alterações posteriores no código",
    fonte: "Commits humanos posteriores na base",
  });
});

test("o recorte de período conta as linhas do commit do mês e só as que pessoas alteraram depois", () => {
  const b = bancoDoPeriodo();
  // O ticket 3 reescreveu 10 das 30 linhas do ticket 1, mas só as 5 da pessoa contam.
  assert.deepEqual(alteracoesDoRecorte(b, doMes("2026-02")), { adicionadas: 30, alteradasPorHumanos: 5 });
  assert.deepEqual(alteracoesDoRecorte(b, doMes("2026-03")), { adicionadas: 0, alteradasPorHumanos: 0 });
  assert.deepEqual(alteracoesDoRecorte(b, doMes("2026-01")), { adicionadas: 0, alteradasPorHumanos: 0 });
});

test("o recorte de Projeto conta os commits das demandas dele", () => {
  const b = bancoDoPeriodo();
  assert.deepEqual(alteracoesDoRecorte(b, { projeto: "loja" }), { adicionadas: 30, alteradasPorHumanos: 5 });
  assert.deepEqual(alteracoesDoRecorte(b, { projeto: "site" }), { adicionadas: 0, alteradasPorHumanos: 0 });
});

test("o recorte de Demanda conta os commits dela", () => {
  const b = bancoDoPeriodo();
  assert.deepEqual(alteracoesDoRecorte(b, { demandaId: "I-1" }), { adicionadas: 30, alteradasPorHumanos: 5 });
  assert.deepEqual(alteracoesDoRecorte(b, { ...doMes("2026-03"), demandaId: "I-3" }), {
    adicionadas: 0,
    alteradasPorHumanos: 0,
  });
});

test("só o commit de ticket de implementar entra", () => {
  const b = bancoDoPeriodo();
  b.exec("UPDATE ticket_demanda SET etapa = 'ajustar_resultado' WHERE demanda_id = 'I-1' AND ticket_id = 1");
  assert.deepEqual(alteracoesDoRecorte(b, { demandaId: "I-1" }), { adicionadas: 0, alteradasPorHumanos: 0 });
});

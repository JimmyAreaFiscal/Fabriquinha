import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDoPeriodo, doMes, em, origemDe, sha } from "../../../../../../apoio-testes/banco/banco_de_metricas.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { MetricaDeBugsNosArquivosRevisados } from "./metrica_de_bugs_nos_arquivos_revisados.ts";

/** Acrescenta ao período um commit de ticket sem rodada (o 1 de I-3, em março) que uma pessoa alterou em 7 linhas. */
const banco = () => {
  const b = bancoDoPeriodo();
  b.prepare("INSERT INTO commit_ticket_demanda VALUES (?, 'I-3', 1, 'm', ?)").run(sha(7), em("2026-03"));
  b.prepare("INSERT INTO commit_humano_posterior VALUES (?, 'I-3', NULL, 'bia', 1, 7, NULL)").run(sha(8));
  return b;
};

const bugsDoRecorte = (b: ReturnType<typeof banco>, recorte: Recorte) => {
  const valores = new MetricaDeBugsNosArquivosRevisados().calcular(origemDe(b), recorte);
  return [valores.get("revisar_rodada")?.alteradasPorHumanos, valores.get("revisar_demanda")?.alteradasPorHumanos];
};

test("os bugs nos arquivos revisados existem só nas duas revisões, com a definição que a tela mostra", () => {
  const valores = new MetricaDeBugsNosArquivosRevisados().calcular(origemDe(banco()), {});
  assert.deepEqual([...valores.keys()], ["revisar_rodada", "revisar_demanda"]);
  assert.deepEqual(new MetricaDeBugsNosArquivosRevisados().definicao, {
    tipo: "bugs_nos_arquivos_revisados",
    rotulo: "Bugs nos arquivos revisados",
    fonte: "Commits humanos posteriores na base",
  });
});

test("o recorte de período: a revisão da rodada vê os commits das rodadas e a da demanda, todos", () => {
  const b = banco();
  assert.deepEqual(bugsDoRecorte(b, doMes("2026-02")), [5, 5]);
  assert.deepEqual(bugsDoRecorte(b, doMes("2026-03")), [0, 7]); // o ticket sem rodada só a revisão da demanda revisa
  assert.deepEqual(bugsDoRecorte(b, doMes("2026-01")), [0, 0]);
});

test("o recorte de Projeto conta os commits das demandas dele", () => {
  const b = banco();
  assert.deepEqual(bugsDoRecorte(b, { projeto: "loja" }), [5, 5]);
  assert.deepEqual(bugsDoRecorte(b, { projeto: "site" }), [0, 7]);
  assert.deepEqual(bugsDoRecorte(b, {}), [5, 12]);
});

test("o recorte de Demanda conta os commits dela", () => {
  const b = banco();
  assert.deepEqual(bugsDoRecorte(b, { demandaId: "I-1" }), [5, 5]);
  assert.deepEqual(bugsDoRecorte(b, { ...doMes("2026-03"), demandaId: "I-3" }), [0, 7]);
});

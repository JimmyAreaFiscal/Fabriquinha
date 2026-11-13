import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDoPeriodo, doMes, em, origemDe, sha } from "../../../../apoio-testes/banco/banco_de_metricas.ts";
import type { Recorte } from "../../../modulos/ciclo_de_vida/publico.ts";
import {
  alteracoesPosterioresPorEtapa,
  bugsNosArquivosRevisadosPorEtapa,
  DEFINICAO_DAS_ALTERACOES_POSTERIORES,
  DEFINICAO_DOS_BUGS_NOS_ARQUIVOS_REVISADOS,
} from "./metricas_dos_commits.ts";

const alteracoesDoRecorte = (b: ReturnType<typeof bancoDoPeriodo>, recorte: Recorte) =>
  alteracoesPosterioresPorEtapa(origemDe(b), recorte).get("implementar");

test("as alterações posteriores existem só em implementar, com a definição que a tela mostra", () => {
  const valores = alteracoesPosterioresPorEtapa(origemDe(bancoDoPeriodo()), {});
  assert.deepEqual([...valores.keys()], ["implementar"]);
  assert.deepEqual(DEFINICAO_DAS_ALTERACOES_POSTERIORES, {
    tipo: "alteracoes_posteriores",
    rotulo: "Alterações posteriores no código",
    fonte: "Commits humanos posteriores na base",
  });
});

test("alterações posteriores: o recorte de período conta as linhas do commit do mês e só as que pessoas alteraram depois", () => {
  const b = bancoDoPeriodo();
  // O ticket 3 reescreveu 10 das 30 linhas do ticket 1, mas só as 5 da pessoa contam.
  assert.deepEqual(alteracoesDoRecorte(b, doMes("2026-02")), { adicionadas: 30, alteradasPorHumanos: 5 });
  assert.deepEqual(alteracoesDoRecorte(b, doMes("2026-03")), { adicionadas: 0, alteradasPorHumanos: 0 });
  assert.deepEqual(alteracoesDoRecorte(b, doMes("2026-01")), { adicionadas: 0, alteradasPorHumanos: 0 });
});

test("alterações posteriores: o recorte de Projeto conta os commits das demandas dele", () => {
  const b = bancoDoPeriodo();
  assert.deepEqual(alteracoesDoRecorte(b, { projeto: "loja" }), { adicionadas: 30, alteradasPorHumanos: 5 });
  assert.deepEqual(alteracoesDoRecorte(b, { projeto: "site" }), { adicionadas: 0, alteradasPorHumanos: 0 });
});

test("alterações posteriores: o recorte de Demanda conta os commits dela", () => {
  const b = bancoDoPeriodo();
  assert.deepEqual(alteracoesDoRecorte(b, { demandaId: "I-1" }), { adicionadas: 30, alteradasPorHumanos: 5 });
  assert.deepEqual(alteracoesDoRecorte(b, { ...doMes("2026-03"), demandaId: "I-3" }), {
    adicionadas: 0,
    alteradasPorHumanos: 0,
  });
});

test("alterações posteriores: só o commit de ticket de implementar entra", () => {
  const b = bancoDoPeriodo();
  b.exec("UPDATE ticket_demanda SET etapa = 'ajustar_resultado' WHERE demanda_id = 'I-1' AND ticket_id = 1");
  assert.deepEqual(alteracoesDoRecorte(b, { demandaId: "I-1" }), { adicionadas: 0, alteradasPorHumanos: 0 });
});

/** Acrescenta ao período um commit de ticket sem rodada (o 1 de I-3, em março) que uma pessoa alterou em 7 linhas. */
const bancoComCommitSemRodada = () => {
  const b = bancoDoPeriodo();
  b.prepare("INSERT INTO commit_ticket_demanda VALUES (?, 'I-3', 1, 'm', ?)").run(sha(7), em("2026-03"));
  b.prepare("INSERT INTO commit_humano_posterior VALUES (?, 'I-3', NULL, 'bia', 1, 7, NULL)").run(sha(8));
  return b;
};

const bugsDoRecorte = (b: ReturnType<typeof bancoComCommitSemRodada>, recorte: Recorte) => {
  const valores = bugsNosArquivosRevisadosPorEtapa(origemDe(b), recorte);
  return [valores.get("revisar_rodada")?.alteradasPorHumanos, valores.get("revisar_demanda")?.alteradasPorHumanos];
};

test("os bugs nos arquivos revisados existem só nas duas revisões, com a definição que a tela mostra", () => {
  const valores = bugsNosArquivosRevisadosPorEtapa(origemDe(bancoComCommitSemRodada()), {});
  assert.deepEqual([...valores.keys()], ["revisar_rodada", "revisar_demanda"]);
  assert.deepEqual(DEFINICAO_DOS_BUGS_NOS_ARQUIVOS_REVISADOS, {
    tipo: "bugs_nos_arquivos_revisados",
    rotulo: "Bugs nos arquivos revisados",
    fonte: "Commits humanos posteriores na base",
  });
});

test("bugs nos arquivos revisados: o recorte de período: a revisão da rodada vê os commits das rodadas e a da demanda, todos", () => {
  const b = bancoComCommitSemRodada();
  assert.deepEqual(bugsDoRecorte(b, doMes("2026-02")), [5, 5]);
  assert.deepEqual(bugsDoRecorte(b, doMes("2026-03")), [0, 7]); // o ticket sem rodada só a revisão da demanda revisa
  assert.deepEqual(bugsDoRecorte(b, doMes("2026-01")), [0, 0]);
});

test("bugs nos arquivos revisados: o recorte de Projeto conta os commits das demandas dele", () => {
  const b = bancoComCommitSemRodada();
  assert.deepEqual(bugsDoRecorte(b, { projeto: "loja" }), [5, 5]);
  assert.deepEqual(bugsDoRecorte(b, { projeto: "site" }), [0, 7]);
  assert.deepEqual(bugsDoRecorte(b, {}), [5, 12]);
});

test("bugs nos arquivos revisados: o recorte de Demanda conta os commits dela", () => {
  const b = bancoComCommitSemRodada();
  assert.deepEqual(bugsDoRecorte(b, { demandaId: "I-1" }), [5, 5]);
  assert.deepEqual(bugsDoRecorte(b, { ...doMes("2026-03"), demandaId: "I-3" }), [0, 7]);
});

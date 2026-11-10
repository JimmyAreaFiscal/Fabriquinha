import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDaDemanda, gravarDecisao, gravarExecucao } from "../../../apoio-testes/banco_de_metricas.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../nucleo/primitivos.ts";
import { MetricaDeExigenciasDeAlteracao } from "./metrica_de_exigencias_de_alteracao.ts";
import { MetricaDeUso } from "./metrica_de_uso.ts";

const daEtapa = <Valor>(valores: Map<EtapaTicket, Valor>, etapa: EtapaTicket): Valor => {
  const valor = valores.get(etapa);
  assert.ok(valor);
  return valor;
};

/** A demanda das métricas de uso, com o ticket 2 (a Tentativa reprovada) e o 4 na revisão. */
const bancoDaRevisao = () => {
  const b = bancoDaDemanda();
  b.exec("UPDATE ticket_demanda SET etapa = 'revisar_rodada' WHERE ticket_id = 2");
  b.exec("UPDATE ticket_demanda SET etapa = 'revisar_demanda' WHERE ticket_id = 4");
  return b;
};

test("CA-2: cada etapa mostra execuções, falhas, devoluções e reprovações", () => {
  const b = bancoDaRevisao();
  gravarExecucao(b, 1, "e0", 1);
  gravarExecucao(b, 2, "e1", 0);
  gravarExecucao(b, 2, "e2", 1);
  gravarDecisao(b, 2, 1, "reprovado", null);
  gravarDecisao(b, 1, 1, "reprovado", null);
  gravarDecisao(b, 1, 2, "aprovado", null);
  const recorte = { demandaId: "I-1" };
  const uso = new MetricaDeUso().calcular(b, recorte);
  const exigencias = new MetricaDeExigenciasDeAlteracao().calcular(b, recorte);
  assert.deepEqual(
    (["planejar", "revisar_rodada"] as const).map((etapa) => [
      daEtapa(uso, etapa).execucoes,
      daEtapa(uso, etapa).falhas,
    ]),
    [
      [1, 1],
      [2, 1],
    ],
  );
  // A Decisão reprovada e a Tentativa reprovada do ticket 2 somam; a Decisão do planejar não é exigência de revisão.
  assert.deepEqual(daEtapa(exigencias, "revisar_rodada"), { reprovacoes: 2 });
  assert.deepEqual(daEtapa(exigencias, "revisar_demanda"), { reprovacoes: 0 });
  assert.equal(daEtapa(uso, "encerrar_rodada").execucoes, 0);
  assert.deepEqual([...exigencias.keys()], ["revisar_rodada", "revisar_demanda"]);
});

test("as exigências de alteração somam as reprovações da revisão da rodada e da demanda, cada uma na sua Etapa", () => {
  const b = bancoDaRevisao();
  gravarDecisao(b, 4, 1, "reprovado", null);
  gravarDecisao(b, 4, 2, "aprovado", null);
  const exigencias = new MetricaDeExigenciasDeAlteracao().calcular(b, { demandaId: "I-1" });
  assert.deepEqual(daEtapa(exigencias, "revisar_rodada"), { reprovacoes: 1 }); // só a Tentativa reprovada
  assert.deepEqual(daEtapa(exigencias, "revisar_demanda"), { reprovacoes: 1 });
  assert.deepEqual(new MetricaDeExigenciasDeAlteracao().definicao, {
    tipo: "exigencias_de_alteracao",
    rotulo: "Exigências de alteração",
    fonte: "Decisões de reprovação e Tentativas",
  });
});

test("o recorte de período, de Projeto e de Demanda limitam as exigências", () => {
  const b = bancoDaRevisao();
  gravarDecisao(b, 2, 1, "reprovado", null);
  const reprovacoesDaRevisao = (recorte: Recorte) =>
    daEtapa(new MetricaDeExigenciasDeAlteracao().calcular(b, recorte), "revisar_rodada").reprovacoes;
  const janeiro = { inicio: "2026-01-01T00:00:00.000Z", fim: "2026-02-01T00:00:00.000Z" };
  assert.equal(reprovacoesDaRevisao(janeiro), 2);
  assert.equal(reprovacoesDaRevisao({ inicio: janeiro.fim, fim: "2026-03-01T00:00:00.000Z" }), 0);
  assert.equal(reprovacoesDaRevisao({ projeto: "p" }), 2);
  assert.equal(reprovacoesDaRevisao({ projeto: "outro" }), 0);
  assert.equal(reprovacoesDaRevisao({ demandaId: "I-1" }), 2);
  assert.equal(reprovacoesDaRevisao({ ...janeiro, demandaId: "I-1" }), 2);
});

// As consultas de Métricas: o período padrão vem do relógio, o período inválido é recusado e a leitura não deixa transação aberta.
process.env.TZ = "America/Sao_Paulo"; // o mês do relógio é o do fuso do serviço

import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { abrirBancoTemporario } from "../../../apoio-testes/banco_temporario.ts";
import { relogioFixo } from "../../nucleo/relogio.ts";
import { consultarMetricasDasDemandas, consultarMetricasDosMeses } from "./metricas.ts";

const relogio = relogioFixo("2026-03-15T12:00:00.000Z");

test("sem `de` nem `ate`, os 11 meses antes do mês do relógio mais o corrente", () => {
  const { banco } = abrirBancoTemporario();
  const meses = consultarMetricasDosMeses(banco, {}, relogio).map((m) => m.mes);
  assert.deepEqual([meses[0], meses.at(-1), meses.length], ["2025-04", "2026-03", 12]);
  assert.equal(banco.isTransaction, false);
});

test("só `ate` leva `de` 11 meses antes; `de` e `ate` dados valem como estão", () => {
  const { banco } = abrirBancoTemporario();
  const meses = (filtro: Parameters<typeof consultarMetricasDosMeses>[1]) =>
    consultarMetricasDosMeses(banco, filtro, relogio).map((m) => m.mes);
  assert.deepEqual(meses({ ate: "2026-01" }).slice(0, 2), ["2025-02", "2025-03"]);
  assert.deepEqual(meses({ de: "2026-01", ate: "2026-02" }), ["2026-01", "2026-02"]);
  assert.deepEqual(meses({ de: "2026-02" }), ["2026-02", "2026-03"]);
});

test("`de` depois de `ate` ou mais de 24 meses é recusado, nas duas visões", () => {
  const { banco } = abrirBancoTemporario();
  for (const consultar of [consultarMetricasDosMeses, consultarMetricasDasDemandas]) {
    assert.throws(() => consultar(banco, { de: "2026-05", ate: "2026-04" }, relogio), z.ZodError);
    assert.throws(() => consultar(banco, { de: "2024-03", ate: "2026-03" }, relogio), /no máximo 24 meses/);
    assert.doesNotThrow(() => consultar(banco, { de: "2024-04", ate: "2026-03" }, relogio));
  }
  assert.equal(banco.isTransaction, false);
});

test("a visão por demanda de um período sem execução vem vazia, com o rodapé zerado", () => {
  const { banco } = abrirBancoTemporario();
  const { demandas, total } = consultarMetricasDasDemandas(banco, {}, relogio);
  assert.deepEqual(demandas, []);
  assert.deepEqual([total.execucoes, total.textoDoCusto, total.nota], [0, "US$ 0,00", null]);
  assert.equal(banco.isTransaction, false);
});

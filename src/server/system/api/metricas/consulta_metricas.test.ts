// As consultas de Métricas: o período padrão vem do relógio, o período inválido é recusado e a leitura não deixa transação aberta.
process.env.TZ = "America/Sao_Paulo"; // o mês do relógio é o do fuso do serviço

import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { consultarMetricasDasDemandas, consultarMetricasDosMeses } from "./consulta_metricas.ts";
import { contarExecucoesSql } from "../../../../../estresse/referencia/contador_de_execucoes_sql.ts";
import { semearVolume } from "../../../../../estresse/referencia/semeadura_dos_volumes.ts";
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../banco_da_fabriquinha.ts";

const relogio = relogioFixo("2026-03-15T12:00:00.000Z");

test("sem `de` nem `ate`, os 11 meses antes do mês do relógio mais o corrente", () => {
  const { banco } = abrirBancoTemporario();
  const meses = consultarMetricasDosMeses(
    banco,
    montarCicloDeVidaDoBanco(banco),
    montarDemandasDoBanco(banco),
    {},
    relogio,
  ).map((m) => m.mes);
  assert.deepEqual([meses[0], meses.at(-1), meses.length], ["2025-04", "2026-03", 12]);
  assert.equal(banco.isTransaction, false);
});

test("só `ate` leva `de` 11 meses antes; `de` e `ate` dados valem como estão", () => {
  const { banco } = abrirBancoTemporario();
  const meses = (filtro: Parameters<typeof consultarMetricasDosMeses>[3]) =>
    consultarMetricasDosMeses(
      banco,
      montarCicloDeVidaDoBanco(banco),
      montarDemandasDoBanco(banco),
      filtro,
      relogio,
    ).map((m) => m.mes);
  assert.deepEqual(meses({ ate: "2026-01" }).slice(0, 2), ["2025-02", "2025-03"]);
  assert.deepEqual(meses({ de: "2026-01", ate: "2026-02" }), ["2026-01", "2026-02"]);
  assert.deepEqual(meses({ de: "2026-02" }), ["2026-02", "2026-03"]);
});

test("`de` depois de `ate` ou mais de 24 meses é recusado, nas duas visões", () => {
  const { banco } = abrirBancoTemporario();
  for (const consultar of [consultarMetricasDosMeses, consultarMetricasDasDemandas]) {
    const demandas = montarDemandasDoBanco(banco);
    const cicloDeVida = montarCicloDeVidaDoBanco(banco);
    assert.throws(
      () => consultar(banco, cicloDeVida, demandas, { de: "2026-05", ate: "2026-04" }, relogio),
      z.ZodError,
    );
    assert.throws(
      () => consultar(banco, cicloDeVida, demandas, { de: "2024-03", ate: "2026-03" }, relogio),
      /no máximo 24 meses/,
    );
    assert.doesNotThrow(() => consultar(banco, cicloDeVida, demandas, { de: "2024-04", ate: "2026-03" }, relogio));
  }
  assert.equal(banco.isTransaction, false);
});

test("a visão por demanda de um período sem execução vem vazia, com o rodapé zerado", () => {
  const { banco } = abrirBancoTemporario();
  const { demandas, total } = consultarMetricasDasDemandas(
    banco,
    montarCicloDeVidaDoBanco(banco),
    montarDemandasDoBanco(banco),
    {},
    relogio,
  );
  assert.deepEqual(demandas, []);
  assert.deepEqual([total.execucoes, total.textoDoCusto, total.nota], [0, "US$ 0,00", null]);
  assert.equal(banco.isTransaction, false);
});

/** As execuções SQL de cada visão das Métricas, num banco semeado com `demandas` demandas em 3 meses, para cada período. */
async function execucoesSqlDasMetricas(demandas: number): Promise<Record<string, number>> {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    semearVolume(banco, { nome: `${String(demandas)} demandas`, demandas, meses: 3 }, new Date(AGORA_DO_ENSAIO));
    const relogioDoEnsaio = relogioFixo(AGORA_DO_ENSAIO);
    const execucoesPorVisao: Record<string, number> = {};
    for (const [periodo, filtro] of Object.entries(PERIODOS_DO_ENSAIO)) {
      execucoesPorVisao[`meses ${periodo}`] = await contarExecucoesSql(() =>
        Promise.resolve(
          consultarMetricasDosMeses(
            banco,
            montarCicloDeVidaDoBanco(banco),
            montarDemandasDoBanco(banco),
            filtro,
            relogioDoEnsaio,
          ),
        ),
      );
      execucoesPorVisao[`demandas ${periodo}`] = await contarExecucoesSql(() =>
        Promise.resolve(
          consultarMetricasDasDemandas(
            banco,
            montarCicloDeVidaDoBanco(banco),
            montarDemandasDoBanco(banco),
            filtro,
            relogioDoEnsaio,
          ),
        ),
      );
    }
    return execucoesPorVisao;
  } finally {
    fechar();
  }
}

const AGORA_DO_ENSAIO = "2026-11-12T12:00:00.000Z";
const PERIODOS_DO_ENSAIO = {
  "de um mês": { de: "2026-11", ate: "2026-11" },
  "de doze meses": { de: "2025-12", ate: "2026-11" },
  "de 24 meses": { de: "2024-12", ate: "2026-11" },
};

test("as Métricas por mês e por demanda leem cada fonte uma vez: as execuções SQL não crescem com os meses nem com as demandas", async () => {
  const comTrinta = await execucoesSqlDasMetricas(30);
  const comSessenta = await execucoesSqlDasMetricas(60);
  assert.deepEqual(comSessenta, comTrinta);
  const [umMes, ...outros] = Object.values(comTrinta).filter((_, indice) => indice % 2 === 0);
  const [umMesPorDemanda, ...outrosPorDemanda] = Object.values(comTrinta).filter((_, indice) => indice % 2 === 1);
  assert.deepEqual(
    outros,
    outros.map(() => umMes),
  );
  assert.deepEqual(
    outrosPorDemanda,
    outrosPorDemanda.map(() => umMesPorDemanda),
  );
});

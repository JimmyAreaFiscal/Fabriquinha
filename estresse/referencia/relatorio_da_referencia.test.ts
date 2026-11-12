import assert from "node:assert/strict";
import { test } from "node:test";
import { montarRelatorioDaReferencia } from "./relatorio_da_referencia.ts";

test("uma tabela por volume com p50, p95 e execuções SQL de cada rota, e o cabeçalho da medição", () => {
  const relatorio = montarRelatorioDaReferencia(
    [
      {
        volume: { nome: "pequeno", demandas: 30, meses: 3 },
        rotas: [
          { tela: "Início", caminho: "/api/inicio", p50: 1.234, p95: 5.06, execucoesSql: 42 },
          { tela: "Métricas", caminho: "/api/metricas?de=2026-01&ate=2026-12", p50: 10, p95: 12.35, execucoesSql: 7 },
        ],
      },
      {
        volume: { nome: "grande", demandas: 3000, meses: 24 },
        rotas: [{ tela: "Início", caminho: "/api/inicio", p50: 100, p95: 250.04, execucoesSql: 9001 }],
      },
    ],
    { medidaEm: "2026-11-12T20:00:00.000Z", maquina: "CPU X, Node v22.23.2", chamadasPorRota: 20 },
  );

  assert.equal(
    relatorio,
    [
      "# Referência de desempenho das rotas de leitura",
      "",
      "Gerado por `npm run estresse:referencia`; não edite à mão.",
      "Medida em 2026-11-12T20:00:00.000Z, em CPU X, Node v22.23.2.",
      "Cada rota: 20 chamadas seguidas para os tempos e 1 chamada antes delas para contar as execuções SQL.",
      "",
      "## pequeno: 30 demandas em 3 meses",
      "",
      "| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |",
      "| --- | --- | --: | --: | --: |",
      "| Início | `/api/inicio` | 1.2 | 5.1 | 42 |",
      "| Métricas | `/api/metricas?de=2026-01&ate=2026-12` | 10.0 | 12.3 | 7 |",
      "",
      "## grande: 3000 demandas em 24 meses",
      "",
      "| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |",
      "| --- | --- | --: | --: | --: |",
      "| Início | `/api/inicio` | 100.0 | 250.0 | 9001 |",
      "",
    ].join("\n"),
  );
});

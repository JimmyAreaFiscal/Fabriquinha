// A estimativa do custo pelo catálogo de preços: só o Uso sem custo informado a recebe, com a referência do preço, e a
// soma com outra parcela da mesma chave mantém a marca.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrecoDoCatalogo } from "../../modelos/publico.ts";
import { acumularUso, estimarCustoPeloCatalogo, linhaDeUsoDaExecucao, type UsoDaExecucao } from "./uso_da_execucao.ts";

const PRECO: PrecoDoCatalogo = {
  id: 7,
  modelo: { provedor: "anthropic", nome: "claude-sonnet-5-5" },
  usd_por_milhao: { entrada: 2, saida: 10, cache_leitura: 0.1, cache_escrita: 2.5 },
  origem: "pi",
  vigente_de: "2026-11-01T00:00:00.000Z",
};

const uso = (custo?: number): UsoDaExecucao => ({
  execucao_id: "E-1",
  modelo_provedor: "anthropic",
  modelo_nome: "claude-sonnet-5-5",
  tokens_entrada: 1_000_000,
  tokens_saida: 100_000,
  tokens_cache_leitura: 2_000_000,
  tokens_cache_escrita: 200_000,
  ...(custo !== undefined && { custo }),
});

test("o Uso sem custo informado recebe o custo pelo preço do catálogo e a referência do preço usado", () => {
  // 1M × 2 + 0,1M × 10 + 2M × 0,1 + 0,2M × 2,5 = 2 + 1 + 0,2 + 0,5
  assert.deepEqual(estimarCustoPeloCatalogo(uso(), PRECO), { ...uso(), custo: 3.7, preco_id: 7 });
});

test("o custo informado pelo harness fica como veio, e sem preço no catálogo o custo segue desconhecido", () => {
  assert.deepEqual(estimarCustoPeloCatalogo(uso(0.42), PRECO), uso(0.42));
  assert.deepEqual(estimarCustoPeloCatalogo(uso(), undefined), uso());
});

test("acumularUso soma o custo estimado ao informado e guarda a referência do preço da parcela estimada", () => {
  const estimado = estimarCustoPeloCatalogo(uso(), PRECO);
  assert.deepEqual(acumularUso([uso(1)], estimado).at(-1), {
    ...uso(4.7),
    tokens_entrada: 2_000_000,
    tokens_saida: 200_000,
    tokens_cache_leitura: 4_000_000,
    tokens_cache_escrita: 400_000,
    preco_id: 7,
  });
  assert.equal(acumularUso([estimado], uso(1)).at(-1)?.preco_id, 7);
  // A parcela desconhecida deixa o total desconhecido, e a referência some com o custo.
  assert.deepEqual(Object.keys(acumularUso([estimado], uso()).at(-1) ?? {}).includes("preco_id"), false);
});

test("a linha do Uso de uma execução marca o custo estimado, e só ele", () => {
  assert.deepEqual(linhaDeUsoDaExecucao(estimarCustoPeloCatalogo(uso(), PRECO)), {
    modelo: "anthropic/claude-sonnet-5-5",
    tokens_entrada: 1_000_000,
    tokens_saida: 100_000,
    tokens_cache_leitura: 2_000_000,
    tokens_cache_escrita: 200_000,
    custo: 3.7,
    custo_estimado: true,
    chamadas: 0,
  });
  assert.equal("custo_estimado" in linhaDeUsoDaExecucao(uso(1)), false);
  assert.equal(linhaDeUsoDaExecucao(uso()).custo, null);
});

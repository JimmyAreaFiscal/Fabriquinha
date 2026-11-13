import assert from "node:assert/strict";
import { test } from "node:test";
import { colunasDaConfiguracaoAgente, linhaComConfiguracaoAgente } from "./colunas_da_configuracao_agente.ts";

test("configuração vira colunas com NULL apenas nos campos ausentes", () => {
  assert.deepEqual(colunasDaConfiguracaoAgente(undefined), { modelo_provedor: null, modelo_nome: null, effort: null });
  assert.deepEqual(colunasDaConfiguracaoAgente({}), { modelo_provedor: null, modelo_nome: null, effort: null });
  assert.deepEqual(colunasDaConfiguracaoAgente({ effort: "off" }), {
    modelo_provedor: null,
    modelo_nome: null,
    effort: "off",
  });
  assert.deepEqual(colunasDaConfiguracaoAgente({ modelo: { provedor: "p", nome: "m" } }), {
    modelo_provedor: "p",
    modelo_nome: "m",
    effort: null,
  });
  assert.deepEqual(colunasDaConfiguracaoAgente({ modelo: { provedor: "p", nome: "m" }, effort: "high" }), {
    modelo_provedor: "p",
    modelo_nome: "m",
    effort: "high",
  });
});

test("leitura preserva o resto da linha e só cria configuração quando há valor", () => {
  assert.deepEqual(linhaComConfiguracaoAgente({ id: 1, modelo_provedor: null, modelo_nome: null, effort: null }), {
    id: 1,
  });
  assert.deepEqual(linhaComConfiguracaoAgente({ id: 1, modelo_provedor: null, modelo_nome: null, effort: "off" }), {
    id: 1,
    configuracao_agente: { effort: "off" },
  });
  assert.deepEqual(linhaComConfiguracaoAgente({ id: 1, modelo_provedor: "p", modelo_nome: "m", effort: null }), {
    id: 1,
    configuracao_agente: { modelo: { provedor: "p", nome: "m" } },
  });
  assert.deepEqual(linhaComConfiguracaoAgente({ id: 1, modelo_provedor: "p", modelo_nome: "m", effort: "high" }), {
    id: 1,
    configuracao_agente: { modelo: { provedor: "p", nome: "m" }, effort: "high" },
  });
});

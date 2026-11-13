import assert from "node:assert/strict";
import { test } from "node:test";
import { type ConfiguracaoAgente, resolverConfiguracaoAgente } from "./configuracao_agente.ts";
import { Modelo } from "../../../compartilhado/nucleo/primitivos.ts";

const modeloDoTicket = { provedor: "claude-bridge", nome: "claude-sonnet-5-5" };
const modeloDaEtapa = { provedor: "claude-bridge", nome: "claude-haiku-5-5" };
const modeloDoPadrao = { provedor: "openai-codex", nome: "gpt-6-luna" };
const padrao: ConfiguracaoAgente = { modelo: modeloDoPadrao, effort: "medium" };

test("Modelo é o par provedor + nome, sempre inteiro", () => {
  assert.deepEqual(Modelo.parse({ provedor: "llamacpp", nome: " qwen3-coder " }), {
    provedor: "llamacpp",
    nome: "qwen3-coder",
  });
  for (const rejeitado of [
    { provedor: "OpenAI", nome: "gpt" },
    { provedor: "openai", nome: " " },
    { provedor: "openai", nome: "x".repeat(201) },
    { provedor: "openai" },
    { nome: "gpt" },
  ]) {
    assert.equal(Modelo.safeParse(rejeitado).success, false, JSON.stringify(rejeitado));
  }
});

test("D07 modelo: ticket define e etapa define, vale o do ticket", () => {
  const resolvida = resolverConfiguracaoAgente({
    ticket: { modelo: modeloDoTicket },
    etapaDoProjeto: { modelo: modeloDaEtapa },
    padrao,
  });
  assert.deepEqual(resolvida.modelo, modeloDoTicket);
});

test("D07 modelo: ticket define e etapa não define, vale o do ticket", () => {
  const resolvida = resolverConfiguracaoAgente({ ticket: { modelo: modeloDoTicket }, etapaDoProjeto: {}, padrao });
  assert.deepEqual(resolvida.modelo, modeloDoTicket);
});

test("D07 modelo: ticket não define e etapa define, vale o da etapa", () => {
  const resolvida = resolverConfiguracaoAgente({ ticket: {}, etapaDoProjeto: { modelo: modeloDaEtapa }, padrao });
  assert.deepEqual(resolvida.modelo, modeloDaEtapa);
});

test("D07 modelo: ticket e etapa não definem, vale o padrão", () => {
  assert.deepEqual(resolverConfiguracaoAgente({ ticket: {}, etapaDoProjeto: {}, padrao }).modelo, modeloDoPadrao);
});

test("D07 effort: ticket define e etapa define, vale o do ticket", () => {
  const resolvida = resolverConfiguracaoAgente({
    ticket: { effort: "low" },
    etapaDoProjeto: { effort: "high" },
    padrao,
  });
  assert.equal(resolvida.effort, "low");
});

test("D07 effort: ticket define e etapa não define, vale o do ticket", () => {
  const resolvida = resolverConfiguracaoAgente({ ticket: { effort: "low" }, etapaDoProjeto: {}, padrao });
  assert.equal(resolvida.effort, "low");
});

test("D07 effort: ticket não define e etapa define, vale o da etapa", () => {
  const resolvida = resolverConfiguracaoAgente({ ticket: {}, etapaDoProjeto: { effort: "high" }, padrao });
  assert.equal(resolvida.effort, "high");
});

test("D07 effort: ticket e etapa não definem, vale o padrão (e sem ticket nem etapa também)", () => {
  assert.equal(resolverConfiguracaoAgente({ ticket: {}, etapaDoProjeto: {}, padrao }).effort, "medium");
  assert.deepEqual(resolverConfiguracaoAgente({ padrao }), padrao);
});

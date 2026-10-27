import assert from "node:assert/strict";
import { test } from "node:test";
import { classificarSaidaE2E, resolverModeloEffort } from "./resolucao_ticket.ts";

const sonnet = { modelo_provedor: "claude-bridge", modelo_nome: "claude-sonnet-5-5" };
const haiku = { modelo_provedor: "claude-bridge", modelo_nome: "claude-haiku-5-5" };
const etapa = (extra = {}) => ({ etapa: "implementar", ...extra }) as never;

test("CA-1: o modelo do ticket vence o da etapa", () => {
  assert.deepEqual(resolverModeloEffort(sonnet, etapa(haiku)).modelo, {
    valor: { provedor: "claude-bridge", nome: "claude-sonnet-5-5" },
    origem: "ticket",
  });
});

test("CA-2 e CA-8: sem modelo no ticket, vale o da etapa (mesmo com effort no ticket)", () => {
  const esperado = { valor: { provedor: "claude-bridge", nome: "claude-haiku-5-5" }, origem: "etapa" };
  assert.deepEqual(resolverModeloEffort({}, etapa(haiku)).modelo, esperado);
  assert.deepEqual(resolverModeloEffort({ effort: "low" }, etapa(haiku)).modelo, esperado);
});

test("CA-3 e CA-7: sem nada, padrão do harness (com ou sem etapa)", () => {
  for (const e of [etapa(), undefined]) {
    const r = resolverModeloEffort({}, e);
    assert.deepEqual(r.modelo, { origem: "padrao" });
    assert.deepEqual(r.effort, { origem: "padrao" });
  }
});

test("CA-4: meio modelo no ticket ou na etapa recusa", () => {
  const msg = /modelo_provedor e modelo_nome juntos/;
  assert.throws(() => resolverModeloEffort({ modelo_provedor: "claude-bridge" }, undefined), msg);
  assert.throws(() => resolverModeloEffort({ modelo_nome: "x" }, undefined), msg);
  assert.throws(() => resolverModeloEffort({}, etapa({ modelo_provedor: "claude-bridge" })), msg);
});

test("CA-5 e CA-6: effort do ticket vence; sem ele, herda o da etapa", () => {
  assert.deepEqual(resolverModeloEffort(sonnet, etapa({ effort: "high" })).effort, { valor: "high", origem: "etapa" });
  assert.deepEqual(resolverModeloEffort({ effort: "low" }, etapa({ effort: "high" })).effort, {
    valor: "low",
    origem: "ticket",
  });
});

test("CA-15: origens de modelo e effort são separadas", () => {
  const r = resolverModeloEffort(sonnet, etapa({ effort: "high" }));
  assert.equal(r.modelo.origem, "ticket");
  assert.equal(r.effort.origem, "etapa");
});

test("CA-9 a CA-11: classificação da saída do E2E", () => {
  assert.equal(classificarSaidaE2E(3, 0), "passou");
  assert.equal(classificarSaidaE2E(3, 3), "reprovado");
  assert.equal(classificarSaidaE2E(3, 1), "falha_infraestrutura");
});

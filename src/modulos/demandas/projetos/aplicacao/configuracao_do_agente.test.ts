import assert from "node:assert/strict";
import { test } from "node:test";
import { etapasComModeloOuEffort, parDoModelo } from "./configuracao_do_agente.ts";

test("as etapas do formulário viram as do cadastro: só as com modelo ou effort", () => {
  const opus = { provedor: "anthropic", nome: "claude-opus-5-5" };
  const etapas = [
    { etapa: "planejar" as const, configuracao_agente: { modelo: opus, effort: "high" as const } },
    { etapa: "implementar" as const },
  ];
  assert.deepEqual(etapasComModeloOuEffort({ planejar: etapas[0]?.configuracao_agente, revisar_rodada: {} }), [
    etapas[0],
  ]);
  assert.equal(parDoModelo(opus), "anthropic/claude-opus-5-5");
  assert.equal(parDoModelo(null), undefined);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { branchDemanda, branchRodada, ocupanteDoDono } from "./nome_do_espaco.ts";
import { DemandaId } from "../../../../shared/nucleo/demanda_id.ts";

test("mesmo número local em demandas distintas gera branches distintas", () => {
  assert.equal(branchDemanda("I-196"), "fabriquinha/I-196");
  assert.equal(branchRodada("I-1", 1), "fabriquinha/I-1-1");
  assert.notEqual(branchRodada("I-1", 1), branchRodada("I-2", 1));
});

test("IDs de demanda recusam travessia e sintaxe perigosa de ref", () => {
  for (const ruim of [
    "",
    "I",
    "I-0",
    "../I-1",
    "I-1/../x",
    "I-1/x",
    "..",
    "I-1.lock",
    "I 1",
    "I-1\n",
    "I-1-2",
    "-1",
    "I-1@{",
    "I~1",
    "I-1\\x",
  ]) {
    assert.ok(!DemandaId.safeParse(ruim).success, ruim);
    assert.throws(() => branchDemanda(ruim));
  }
  assert.throws(() => branchRodada("../x", 1));
  assert.throws(() => branchRodada("I-1", 0));
});

test("o dono por extenso: a demanda, ou a demanda e a rodada", () => {
  assert.equal(ocupanteDoDono({ demanda_id: "I-1" }), "I-1");
  assert.equal(ocupanteDoDono({ demanda_id: "I-1", rodada_id: 2 }), "I-1.R2");
});

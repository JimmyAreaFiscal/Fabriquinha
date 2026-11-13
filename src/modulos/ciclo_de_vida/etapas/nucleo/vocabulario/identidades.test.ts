import assert from "node:assert/strict";
import { test } from "node:test";
import {
  branchDemanda,
  branchRodada,
  DemandaId,
  formatarRodadaRef,
  formatarTicketRef,
  RodadaRef,
  TicketIdentidade,
} from "./identidades.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";

test("mesmo número local em demandas distintas gera identidades e branches distintas", () => {
  const a = RodadaRef.parse({ demanda_id: "I-1", rodada_id: 1 });
  const b = RodadaRef.parse({ demanda_id: "I-2", rodada_id: 1 });
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(
    TicketIdentidade.parse({ demanda_id: "I-1", ticket_id: 1 }),
    TicketIdentidade.parse({ demanda_id: "I-2", ticket_id: 1 }),
  );
  assert.equal(TicketIdentidade.parse({ demanda_id: "I-1", ticket_id: 1 }).rodada_id, undefined);
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

test("CA-1 a CA-3: formata o endereço público e recusa referência inválida", () => {
  assert.equal(formatarTicketRef({ demanda_id: "I-206", ticket_id: 3 }), "I-206.T3");
  assert.equal(formatarRodadaRef({ demanda_id: "I-206", rodada_id: 2 }), "I-206.R2");
  for (const f of [
    () => formatarTicketRef({ demanda_id: "../I-206", ticket_id: 3 }),
    () => formatarTicketRef({ demanda_id: "I-206", ticket_id: 0 }),
    () => formatarRodadaRef({ demanda_id: "I-206", rodada_id: 0 }),
  ])
    assert.throws(f, (e) => e instanceof ErroDeRegra && e.message.includes("I-206.T3"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { branchDemanda, branchRodada, DecisaoRef, DemandaId, Plano, RodadaRef, TicketIdentidade } from "./demanda.ts";

const plano = (mudanca: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  criterios: ["CA-1", "CA-2"],
  rodadas: [
    { demanda_id: "I-1", rodada_id: 1, criterios: ["CA-1"] },
    { demanda_id: "I-1", rodada_id: 2, depende: [{ demanda_id: "I-1", rodada_id: 1 }] },
  ],
  tickets: [
    { demanda_id: "I-1", ticket_id: 1 },
    { demanda_id: "I-1", ticket_id: 2, rodada_id: 1 },
    { demanda_id: "I-1", ticket_id: 3, rodada_id: 1, depende: [{ demanda_id: "I-1", ticket_id: 2 }] },
  ],
  ...mudanca,
});
const recusa = (p: unknown, trecho: string) => {
  const r = Plano.safeParse(p);
  assert.ok(!r.success, "deveria recusar");
  assert.ok(
    r.error.issues.some((i) => i.message.includes(trecho)),
    r.error.message,
  );
};
const tk = (ticket_id: number, rodada_id?: number, depende: number[] = []) => ({
  demanda_id: "I-1",
  ticket_id,
  rodada_id,
  depende: depende.map((d) => ({ demanda_id: "I-1", ticket_id: d })),
});
const rd = (rodada_id: number, depende: number[] = [], demanda_id = "I-1") => ({
  demanda_id,
  rodada_id,
  depende: depende.map((d) => ({ demanda_id: "I-1", rodada_id: d })),
});

test("mesmo número local em demandas distintas gera identidades e branches distintas", () => {
  const a = RodadaRef.parse({ demanda_id: "I-1", rodada_id: 1 });
  const b = RodadaRef.parse({ demanda_id: "I-2", rodada_id: 1 });
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(
    TicketIdentidade.parse({ demanda_id: "I-1", ticket_id: 1 }),
    TicketIdentidade.parse({ demanda_id: "I-2", ticket_id: 1 }),
  );
  assert.equal(TicketIdentidade.parse({ demanda_id: "I-1", ticket_id: 1 }).rodada_id, undefined);
  assert.ok(DecisaoRef.safeParse({ demanda_id: "I-1", ticket_id: 1, decisao_id: 1 }).success);
  assert.ok(!DecisaoRef.safeParse({ ticket_id: 1, decisao_id: 1 }).success);
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

test("plano válido é aceito", () => {
  assert.ok(Plano.safeParse(plano()).success);
});

test("plano recusa rodada ou ticket duplicado, de outra demanda ou em rodada inexistente", () => {
  recusa(plano({ rodadas: [rd(1), rd(1)] }), "rodada 1 se repete");
  recusa(plano({ rodadas: [rd(1, [], "I-2")] }), "outra demanda");
  recusa(plano({ tickets: [tk(1), tk(1)] }), "ticket 1 se repete");
  recusa(plano({ tickets: [{ ...tk(1), demanda_id: "I-2" }] }), "outra demanda");
  recusa(plano({ tickets: [tk(1, 9)] }), "rodada 9, que não existe");
});

test("CA-SDLC-03: dependência de rodada recusa autorreferência, ciclo, outra demanda e inexistente", () => {
  recusa(plano({ rodadas: [rd(1, [1])] }), "de si mesma");
  recusa(plano({ rodadas: [rd(1, [2]), rd(2, [1])] }), "ciclo");
  recusa(plano({ rodadas: [rd(1, [3]), rd(2), rd(3, [2]), rd(4, [1, 9])] }), "não existe");
  recusa(
    plano({ rodadas: [{ demanda_id: "I-1", rodada_id: 1, depende: [{ demanda_id: "I-2", rodada_id: 2 }] }, rd(2)] }),
    "outra demanda",
  );
});

test("dependência de ticket recusa autorreferência, ciclo, outra demanda e inexistente", () => {
  recusa(plano({ tickets: [tk(1, 1, [1])] }), "de si mesmo");
  recusa(plano({ tickets: [tk(1, 1, [2]), tk(2, 1, [1])] }), "ciclo");
  recusa(plano({ tickets: [tk(1, 1, [9])] }), "não existe");
  recusa(
    plano({ tickets: [{ ...tk(1, 1), depende: [{ demanda_id: "I-2", ticket_id: 2 }] }, tk(2, 1)] }),
    "outra demanda",
  );
});

test("CA-SDLC-19: dependência entre rodadas distintas ou com ticket sem rodada é recusada", () => {
  recusa(plano({ tickets: [tk(1, 1), tk(2, 2, [1])] }), "outra rodada");
  recusa(plano({ tickets: [tk(1), tk(2, 1, [1])] }), "sem rodada");
  recusa(plano({ tickets: [tk(1, 1), tk(2, undefined, [1])] }), "sem rodada");
});

test("CA-SDLC-19: critério citado ausente entre os CA-n da demanda é recusado", () => {
  recusa(plano({ rodadas: [{ demanda_id: "I-1", rodada_id: 1, criterios: ["CA-9"] }] }), "cita o CA-9");
  recusa(plano({ rodadas: [{ demanda_id: "I-1", rodada_id: 1, criterios: ["criterio"] }] }), "CA-n");
});

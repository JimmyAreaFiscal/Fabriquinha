import assert from "node:assert/strict";
import { test } from "node:test";
import { ProgressoEncerramento } from "./progresso_do_encerramento.ts";

const base = { demanda_id: "I-1", branch: "fabriquinha/I-1", base: "develop", limpeza_pendente: [] as string[] };
const recusa = (valor: unknown, trecho: string) => {
  const r = ProgressoEncerramento.safeParse(valor);
  assert.ok(!r.success, "deveria recusar");
  assert.match(r.error.message, new RegExp(trecho));
};

test("progresso completo e mínimo são válidos", () => {
  assert.ok(ProgressoEncerramento.safeParse(base).success);
  const completo = {
    ...base,
    sha_verificado: "abc",
    integracao: { sha: "def" },
    limpeza_pendente: ["branch"],
    conflito_pendente: { ticket_id: 2 },
    falha: { etapa: "limpeza", motivo: "m" },
  };
  assert.deepEqual(ProgressoEncerramento.parse(completo), completo);
});

test("cada invariante recusa", () => {
  recusa({ ...base, branch: "main" }, "branch do encerramento");
  recusa({ ...base, limpeza_pendente: ["a"] }, "exige a integração");
  recusa({ ...base, integracao: { sha: "d" }, limpeza_pendente: ["a", "a"] }, "se repetem");
});

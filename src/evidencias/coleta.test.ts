import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { depoisDoPi } from "./coleta.ts";

// O descarte do registro e do desenho e o ciclo do desenvolvimento são provados de ponta a ponta em execucao/.
test("etapa sem coleta depois do pi não toca a worktree nem o banco", async () => {
  const ticket = {
    id: 3,
    issue: 1,
    etapa: "sessao" as const,
    titulo: "Cache",
    descricao: "",
    status: "em_execucao" as const,
    origem: "agente" as const,
    criadoEm: "2026-10-11T12:00:00.000Z",
  };
  assert.equal(await depoisDoPi(new DatabaseSync(":memory:"), ticket, "/nao/existe", "/nao/existe/log"), undefined);
});

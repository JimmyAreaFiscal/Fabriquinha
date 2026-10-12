import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Agregado } from "../dominio/agregado.ts";
import { antesDoPi, depoisDoPi } from "./coleta.ts";

// O descarte do registro e do desenho, o ciclo do desenvolvimento e a coleta da revisão antes e depois do pi são
// provados de ponta a ponta em execucao/.
test("etapa sem coleta antes nem depois do pi não toca a worktree nem o banco", async () => {
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
  const banco = new DatabaseSync(":memory:");
  const ag = { issue: { id: 1 } } as Agregado;
  assert.equal(await antesDoPi(banco, ag, ticket, "/nao/existe/log"), ag);
  assert.equal(await depoisDoPi(banco, ticket, "/nao/existe", "/nao/existe/log"), undefined);
});

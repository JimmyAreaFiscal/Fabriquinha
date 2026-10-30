import assert from "node:assert/strict";
import { test } from "node:test";
import { semMedicao } from "./http_mutacao.ts";

test("semMedicao cita método e caminho das rotas POST e DELETE sem ação, e só delas", () => {
  const faltando = semMedicao([{ metodo: "POST", caminho: "/api/demandas/:id/cancelar" }]);
  assert.ok(faltando.includes("POST /api/demandas/:id/decisao"));
  assert.ok(faltando.includes("DELETE /api/projetos/:nome"));
  assert.ok(!faltando.includes("POST /api/demandas/:id/cancelar"));
  assert.ok(faltando.every((r) => !r.startsWith("GET ")));
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exigirGit } from "../../apoio-testes/repositorio_de_teste.ts";
import { esperarMarcaDePreparacao, semMedicao } from "./http_mutacao.ts";

test("semMedicao cita método e caminho das rotas POST e DELETE sem ação, e só delas", () => {
  const faltando = semMedicao([{ metodo: "POST", caminho: "/api/demandas/:id/cancelar" }]);
  assert.ok(faltando.includes("POST /api/demandas/:id/decisao"));
  assert.ok(faltando.includes("DELETE /api/projetos/:nome"));
  assert.ok(!faltando.includes("POST /api/demandas/:id/cancelar"));
  assert.ok(faltando.every((r) => !r.startsWith("GET ")));
});

test("esperarMarcaDePreparacao devolve quando a marca aparece e falha no tempo limite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marca-"));
  try {
    await exigirGit(dir, "init", "-q", "-b", "main");
    const marca = join(dir, ".git", "fabriquinha-preparada");
    await assert.rejects(esperarMarcaDePreparacao(dir, 150), /não terminou em 150 ms/);
    setTimeout(() => {
      writeFileSync(marca, "");
    }, 150);
    await esperarMarcaDePreparacao(dir, 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

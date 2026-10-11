import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { executar } from "./processo.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-processo-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

test("roda no cwd pedido e devolve código, stdout e stderr", async () => {
  const saida = await executar("/bin/sh", ["-c", "pwd; echo erro >&2; exit 3"], { cwd: base });
  assert.deepEqual(saida, { codigo: 3, saida: `${base}\n`, erro: "erro\n", limiteEstourado: false });
});

test("passado o limite, mata o grupo inteiro, não só o shell", async () => {
  const inicio = Date.now();
  // O `sleep` em segundo plano herda o stdout: se só o shell morresse, o close esperaria os 30 s dele.
  const saida = await executar("/bin/sh", ["-c", "sleep 30 & sleep 30"], { limiteMs: 200 });
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, null);
  assert.ok(Date.now() - inicio < 10_000);
});

test("o limite vale também para o neto que segura o stdout depois que o shell saiu", async () => {
  const inicio = Date.now();
  const saida = await executar("/bin/sh", ["-c", "sleep 30 & exit 0"], { limiteMs: 200 });
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, 0);
  assert.ok(Date.now() - inicio < 10_000);
});

test("neto fora do grupo (setsid) não derruba o limite: o kill sem alvo é ignorado e o close vem quando ele sai", async () => {
  const saida = await executar("/bin/sh", ["-c", "setsid sleep 1 & exit 0"], { limiteMs: 100 });
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, 0);
});

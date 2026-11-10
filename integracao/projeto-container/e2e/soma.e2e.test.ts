import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("o programa imprime a soma dos argumentos", () => {
  const saida = execFileSync("node", ["src/soma.ts", "2", "3"], { encoding: "utf8" });
  assert.equal(saida.trim(), "5");
});

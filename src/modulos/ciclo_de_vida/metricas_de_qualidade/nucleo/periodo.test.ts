import assert from "node:assert/strict";
import { test } from "node:test";
import { Periodo } from "./periodo.ts";

test("período inválido: mês fora do formato, `de` depois de `ate` ou projeto fora do slug", () => {
  for (const periodo of [
    { de: "2026-13", ate: "2026-13" },
    { de: "0050-01", ate: "0050-01" }, // o `Date` do JS leria 1950
    { de: "2026-02", ate: "2026-01" },
    { projeto: "Loja", de: "2026-01", ate: "2026-01" },
  ]) {
    assert.equal(Periodo.safeParse(periodo).success, false);
  }
});

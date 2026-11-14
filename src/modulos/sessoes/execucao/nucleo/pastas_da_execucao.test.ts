import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pastasDoProcesso } from "./pastas_da_execucao.ts";

const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-registro-"));
after(() => {
  rmSync(raiz, { recursive: true, force: true });
});

test("pastasDoProcesso: a pasta E-<id> em execucoes e o log dentro dela, sem criar nada", () => {
  assert.deepEqual(pastasDoProcesso(raiz, 7), {
    dir: join(raiz, "execucoes", "E-7"),
    log: join(raiz, "execucoes", "E-7", "log"),
  });
  assert.equal(pastasDoProcesso(raiz, "e-s1").dir, join(raiz, "execucoes", "E-e-s1"));
  assert.equal(existsSync(join(raiz, "execucoes")), false);
});

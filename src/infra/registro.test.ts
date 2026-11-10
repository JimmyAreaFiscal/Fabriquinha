import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { relogioFixo } from "../nucleo/relogio.ts";
import { anotar, logDaOperacao, noLog, pastasDoProcesso } from "./registro.ts";

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

test("logDaOperacao: cria execucoes e devolve o <nome>.log dela", () => {
  assert.equal(logDaOperacao(raiz, "encerramento-I-1"), join(raiz, "execucoes", "encerramento-I-1.log"));
  assert.equal(existsSync(join(raiz, "execucoes")), true);
});

test("anotar e noLog escrevem a hora do Relogio injetado", (t) => {
  const log = join(raiz, "anotar.log");
  const relogio = relogioFixo("2026-05-01T12:00:00.000Z");
  anotar(log, "começou", relogio);
  assert.equal(readFileSync(log, "utf8"), "2026-05-01T12:00:00.000Z começou\n");

  const erro = t.mock.method(console, "error", () => undefined);
  noLog("falhou", relogio);
  assert.deepEqual(erro.mock.calls[0]?.arguments, ["2026-05-01T12:00:00.000Z fabriquinha:", "falhou"]);
});

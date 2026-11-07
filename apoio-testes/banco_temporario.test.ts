import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { abrirBancoTemporario } from "./banco_temporario.ts";

test("abre um banco migrado numa raiz temporária e o fechar apaga a raiz", () => {
  const { raiz, banco, fechar } = abrirBancoTemporario();
  assert.ok(existsSync(join(raiz, "fabriquinha.db")));
  assert.ok(banco.prepare("SELECT 1 FROM sqlite_master WHERE name = 'demanda'").get());
  fechar();
  assert.equal(existsSync(raiz), false);
  assert.doesNotThrow(fechar);
});

test("cada chamada tem a sua raiz e o seu banco", () => {
  const um = abrirBancoTemporario();
  const outro = abrirBancoTemporario();
  assert.notEqual(um.raiz, outro.raiz);
  um.fechar();
  outro.fechar();
});

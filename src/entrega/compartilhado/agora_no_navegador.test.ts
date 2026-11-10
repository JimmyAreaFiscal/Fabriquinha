import assert from "node:assert/strict";
import { test } from "node:test";
import { agoraNoNavegador } from "./agora_no_navegador.ts";

test("agoraNoNavegador devolve os milissegundos do relógio do navegador", () => {
  const antes = Date.now();
  const agora = agoraNoNavegador();
  assert.ok(agora >= antes && agora <= Date.now());
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as dormir } from "node:timers/promises";
import { test } from "node:test";
import { grupoEstaVivo } from "./grupo_de_processo.ts";

test("o grupo vivo é o que tem processo; o zumbi ou o que já saiu não conta, com ou sem init que o recolha", async () => {
  // O líder (`sh`) sai logo; o `sleep` fica órfão no mesmo grupo, e depois que ele acaba só sobra um zumbi, ou nada.
  const lider = spawn("sh", ["-c", "sleep 0.5 &"], { detached: true, stdio: "ignore" });
  const grupo = Number(lider.pid);
  await dormir(100);
  assert.equal(grupoEstaVivo(grupo), true);

  const limite = Date.now() + 5000;
  while (grupoEstaVivo(grupo) && Date.now() < limite) await dormir(50);
  assert.equal(grupoEstaVivo(grupo), false);
  assert.equal(grupoEstaVivo(2 ** 22), false, "um grupo que nunca existiu");
});

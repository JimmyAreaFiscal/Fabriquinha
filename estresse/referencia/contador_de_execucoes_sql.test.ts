import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { contarExecucoesSql } from "./contador_de_execucoes_sql.ts";

test("conta cada run, get, all e iterate de um statement, e não a preparação", async () => {
  const banco = new DatabaseSync(":memory:");
  banco.exec("CREATE TABLE numero (valor INTEGER)");
  const inserirNumero = banco.prepare("INSERT INTO numero VALUES (?)");
  const lerNumeros = banco.prepare("SELECT valor FROM numero");

  const execucoesSoDePreparar = await contarExecucoesSql(async () => {
    banco.prepare("SELECT 1");
    await Promise.resolve();
  });
  const execucoesDasLeiturasEEscritas = await contarExecucoesSql(async () => {
    inserirNumero.run(1);
    inserirNumero.run(2);
    await Promise.resolve();
    assert.deepEqual({ ...lerNumeros.get() }, { valor: 1 });
    assert.equal(lerNumeros.all().length, 2);
    assert.equal([...lerNumeros.iterate()].length, 2);
  });
  banco.close();

  assert.equal(execucoesSoDePreparar, 0);
  assert.equal(execucoesDasLeiturasEEscritas, 5);
});

test("contagens seguidas não se somam nem instalam o contador duas vezes", async () => {
  const banco = new DatabaseSync(":memory:");
  const lerUm = banco.prepare("SELECT 1");
  const primeira = await contarExecucoesSql(() => Promise.resolve(lerUm.get()));
  const segunda = await contarExecucoesSql(() => Promise.resolve(lerUm.get()));
  banco.close();
  assert.deepEqual([primeira, segunda], [1, 1]);
});

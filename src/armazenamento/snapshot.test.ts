import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { escrever } from "./banco.ts";
import { lerEmSnapshot } from "./snapshot.ts";

test("fora de transação, abre o snapshot, devolve a leitura e fecha", () => {
  const banco = new DatabaseSync(":memory:");
  const emTransacaoDuranteALeitura = lerEmSnapshot(banco, () => banco.isTransaction);
  assert.equal(emTransacaoDuranteALeitura, true);
  assert.equal(banco.isTransaction, false);
});

test("fora de transação, fecha o snapshot mesmo quando a leitura falha", () => {
  const banco = new DatabaseSync(":memory:");
  assert.throws(
    () =>
      lerEmSnapshot(banco, () => {
        throw new Error("leitura falhou");
      }),
    /leitura falhou/,
  );
  assert.equal(banco.isTransaction, false);
});

test("dentro de escrever, reaproveita a transação sem confirmá-la", () => {
  const banco = new DatabaseSync(":memory:");
  escrever(banco, () => {
    assert.equal(
      lerEmSnapshot(banco, () => 42),
      42,
    );
    assert.equal(banco.isTransaction, true);
  });
  assert.equal(banco.isTransaction, false);
});

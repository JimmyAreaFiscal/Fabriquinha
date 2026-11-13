// As predecessoras de cada pedido, lidas em lote num banco temporário.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoComProjeto, registrarPedidoDeTeste } from "../../../../../apoio-testes/cenarios/pedidos_de_teste.ts";
import { predecessorasDosPedidosEmLote } from "./dependencias.ts";

test("as predecessoras de cada pedido vêm na ordem da gravação; o sem predecessora e o desconhecido, vazios", () => {
  const banco = bancoComProjeto();
  const a = registrarPedidoDeTeste(banco);
  const b = registrarPedidoDeTeste(banco);
  const c = registrarPedidoDeTeste(banco, [b, a]);
  const d = registrarPedidoDeTeste(banco, [c]);
  assert.deepEqual(
    predecessorasDosPedidosEmLote(banco, [d, c, a, "I-999"]),
    new Map([
      [d, [c]],
      [c, [b, a]],
      [a, []],
      ["I-999", []],
    ]),
  );
  assert.deepEqual(predecessorasDosPedidosEmLote(banco, []), new Map());
});

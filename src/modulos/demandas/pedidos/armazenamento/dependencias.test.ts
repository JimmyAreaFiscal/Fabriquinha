// As arestas das relações de cada pedido, lidas num banco temporário.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoComProjeto, registrarPedidoDeTeste } from "../../../../../apoio-testes/cenarios/pedidos_de_teste.ts";
import { arestasDasRelacoesDosPedidos } from "./dependencias.ts";

test("as arestas das predecessoras e de todos os dependentes descendo o grafo, com as situações; nada além delas", () => {
  const banco = bancoComProjeto();
  const a = registrarPedidoDeTeste(banco);
  const b = registrarPedidoDeTeste(banco);
  const c = registrarPedidoDeTeste(banco, [b, a]);
  const d = registrarPedidoDeTeste(banco, [c]);
  const solto = registrarPedidoDeTeste(banco);
  registrarPedidoDeTeste(banco, [solto]);
  const { arestas, situacoes } = arestasDasRelacoesDosPedidos(banco, [c, "I-999"]);
  assert.deepEqual(arestas, [
    { demanda_id: c, depende_demanda_id: b },
    { demanda_id: c, depende_demanda_id: a },
    { demanda_id: d, depende_demanda_id: c },
  ]);
  assert.deepEqual([...situacoes.keys()].toSorted(), [a, b, c, d].toSorted());
  assert.deepEqual(arestasDasRelacoesDosPedidos(banco, []).arestas, []);
});

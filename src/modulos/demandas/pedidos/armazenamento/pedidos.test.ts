// A origem do pedido num banco temporário: o achado da Avaliação de onde ele foi encaminhado.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoComProjeto, registrarPedidoDeTeste } from "../../../../../apoio-testes/pedidos_de_teste.ts";
import { origemDoPedido } from "./pedidos.ts";

test("o pedido encaminhado de um achado tem a origem dele; o registrado direto, nenhuma", () => {
  const banco = bancoComProjeto();
  const encaminhado = registrarPedidoDeTeste(banco);
  const direto = registrarPedidoDeTeste(banco);
  banco.exec(`INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em)
                VALUES ('av-1', 'fabriquinha', '2026-01-01', '2026-01-31', '', 't');
              INSERT INTO achado_avaliacao (avaliacao_id, achado_id, titulo, descricao, evidencia, demanda_id)
                VALUES ('av-1', 3, 'Achado', 'd', 'e', '${encaminhado}')`);
  assert.deepEqual({ ...origemDoPedido(banco, encaminhado) }, { avaliacao_id: "av-1", achado_id: 3, titulo: "Achado" });
  assert.equal(origemDoPedido(banco, direto), undefined);
});

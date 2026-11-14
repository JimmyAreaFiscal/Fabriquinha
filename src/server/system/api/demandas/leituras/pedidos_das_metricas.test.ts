import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDoPeriodo, em } from "../../../../../../apoio-testes/banco/banco_de_metricas.ts";
import { lerPedidosDasMetricas } from "./pedidos_das_metricas.ts";
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../../banco_da_fabriquinha.ts";

test("os pedidos das Métricas, de todas as demandas ou das pedidas, com o registro e a conclusão do histórico", () => {
  const banco = bancoDoPeriodo();
  banco.exec(`INSERT INTO demanda_historico (demanda_id, criada_em, concluida_em)
    VALUES ('I-2', '2026-01-03T00:00:00.000Z', '2026-03-04T00:00:00.000Z')`);
  assert.deepEqual(
    lerPedidosDasMetricas(banco, montarCicloDeVidaDoBanco(banco), montarDemandasDoBanco(banco)).map(
      (pedido) => pedido.id,
    ),
    ["I-1", "I-2", "I-3"],
  );
  assert.deepEqual(
    lerPedidosDasMetricas(banco, montarCicloDeVidaDoBanco(banco), montarDemandasDoBanco(banco), ["I-2", "I-1"]),
    [
      {
        id: "I-1",
        projeto: "loja",
        titulo: "Título I-1",
        estado: "em_execucao",
        estadoAlteradoEm: em("2026-03"),
        criadaEm: null,
        concluidaEm: null,
      },
      {
        id: "I-2",
        projeto: "loja",
        titulo: "Título I-2",
        estado: "concluida",
        estadoAlteradoEm: em("2026-03"),
        criadaEm: "2026-01-03T00:00:00.000Z",
        concluidaEm: "2026-03-04T00:00:00.000Z",
      },
    ],
  );
});

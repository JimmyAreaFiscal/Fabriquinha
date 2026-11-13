// A leitura em lote das Decisões, sem o agregado: por demanda e, com período, pelo instante da Decisão.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDaDemanda, bancoDoPeriodo, doMes, em } from "../../../../../apoio-testes/banco_de_metricas.ts";
import { decisoesEmLote, tentativasReprovadasEmLote } from "./estado_do_processo.ts";

test("as Decisões das demandas em lote, com o resultado, a nota e o instante, e o período pelo instante", () => {
  const banco = bancoDoPeriodo();
  assert.deepEqual(decisoesEmLote(banco, { demandas: ["I-1"] }), [
    { demanda_id: "I-1", ticket_id: 1, resultado: "reprovado", nota: null, em: em("2026-02") },
    { demanda_id: "I-1", ticket_id: 2, resultado: "aprovado", nota: 4, em: em("2026-02") },
    { demanda_id: "I-1", ticket_id: 2, resultado: "aprovado", nota: 5, em: em("2026-02") },
  ]);
  assert.equal(decisoesEmLote(banco, { demandas: ["I-1"], periodo: doMes("2026-02") }).length, 3);
  assert.deepEqual(decisoesEmLote(banco, { demandas: ["I-1"], periodo: doMes("2026-03") }), []);
  assert.deepEqual(decisoesEmLote(banco, { demandas: ["I-3"] }), []);
});

test("as Tentativas reprovadas das demandas em lote, só com o ticket, e o período pelo início", () => {
  const banco = bancoDaDemanda();
  banco.exec(`INSERT INTO tentativa (demanda_id, ticket_id, numero, inicio, fim, resultado_tipo)
    VALUES ('I-1', 4, 1, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'sucesso')`);
  assert.deepEqual(tentativasReprovadasEmLote(banco, { demandas: ["I-1"] }), [{ demanda_id: "I-1", ticket_id: 2 }]);
  assert.deepEqual(tentativasReprovadasEmLote(banco, { demandas: ["I-1"], periodo: doMes("2026-02") }), []);
  assert.deepEqual(tentativasReprovadasEmLote(banco, { demandas: [] }), []);
});

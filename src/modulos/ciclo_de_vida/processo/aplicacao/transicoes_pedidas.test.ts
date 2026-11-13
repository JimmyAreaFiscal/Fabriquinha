// As transições pedidas ao Processo: as demais são testadas pelas conduções que as pedem.
import assert from "node:assert/strict";
import { test } from "node:test";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { falhaQueExigeOAuditor } from "../../etapas/publico.ts";
import { cenarioDeImplementacao, ref, ticket } from "../../../../../apoio-testes/cenario_de_implementacao.ts";
import { falharTicketEmExecucao } from "./transicoes_pedidas.ts";

test("falharTicketEmExecucao falha o ticket em execução de qualquer etapa e ignora o que não está em execução", async () => {
  const c = await cenarioDeImplementacao({
    tickets: [ticket(1, "planejar", "em_execucao"), ticket(2, "implementar", "aberto", { rodada_id: 1 })],
  });
  falharTicketEmExecucao(c.banco, ref(1), falhaQueExigeOAuditor("x"));
  falharTicketEmExecucao(c.banco, ref(2), falhaQueExigeOAuditor("x"));
  assert.deepEqual([c.status(1)?.estado, c.motivo(1), c.status(2)?.estado], ["falhou", "x", "aberto"]);
});

test("falharTicketEmExecucao grava a falha no instante do relógio recebido", async () => {
  const c = await cenarioDeImplementacao({ tickets: [ticket(1, "planejar", "em_execucao")] });
  falharTicketEmExecucao(c.banco, ref(1), falhaQueExigeOAuditor("x"), relogioFixo("2030-05-06T07:08:09.000Z"));
  assert.equal(c.status(1)?.estado_alterado_em, "2030-05-06T07:08:09.000Z");
});

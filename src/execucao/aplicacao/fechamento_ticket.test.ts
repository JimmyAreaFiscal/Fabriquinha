// Falha do ticket em execução, de qualquer etapa; o fechamento do implementar e do resolver_conflito é testado nas conduções.
import assert from "node:assert/strict";
import { test } from "node:test";
import { relogioFixo } from "../../compartilhado/nucleo/relogio.ts";
import { falhaQueExigeOAuditor } from "../nucleo/tentativa.ts";
import { cenarioDeImplementacao, ref, ticket } from "../../../apoio-testes/cenario_de_implementacao.ts";
import { falharTicketDemanda } from "./fechamento_ticket.ts";

test("falharTicketDemanda falha o ticket em execução de qualquer etapa e ignora o que não está em execução", async () => {
  const c = await cenarioDeImplementacao({
    tickets: [ticket(1, "planejar", "em_execucao"), ticket(2, "implementar", "aberto", { rodada_id: 1 })],
  });
  falharTicketDemanda(c.banco, ref(1), falhaQueExigeOAuditor("x"));
  falharTicketDemanda(c.banco, ref(2), falhaQueExigeOAuditor("x"));
  assert.deepEqual([c.status(1)?.estado, c.motivo(1), c.status(2)?.estado], ["falhou", "x", "aberto"]);
});

test("falharTicketDemanda grava a falha no instante do relógio recebido", async () => {
  const c = await cenarioDeImplementacao({ tickets: [ticket(1, "planejar", "em_execucao")] });
  falharTicketDemanda(c.banco, ref(1), falhaQueExigeOAuditor("x"), relogioFixo("2030-05-06T07:08:09.000Z"));
  assert.equal(c.status(1)?.estado_alterado_em, "2030-05-06T07:08:09.000Z");
});

// Falha do ticket em execução, de qualquer etapa; o fechamento do implementar e do resolver_conflito é testado nas conduções.
import assert from "node:assert/strict";
import { test } from "node:test";
import { falhaQueExigeOAuditor } from "../nucleo/tentativa.ts";
import { cenarioDeImplementacao, ref, ticket } from "../../apoio-testes/cenario_de_implementacao.ts";
import { falharTicketDemanda } from "./fechamento_ticket.ts";

test("falharTicketDemanda falha o ticket em execução de qualquer etapa e ignora o que não está em execução", async () => {
  const c = await cenarioDeImplementacao({
    tickets: [ticket(1, "planejar", "em_execucao"), ticket(2, "implementar", "aberto", { rodada_id: 1 })],
  });
  falharTicketDemanda(c.banco, ref(1), falhaQueExigeOAuditor("x"));
  falharTicketDemanda(c.banco, ref(2), falhaQueExigeOAuditor("x"));
  assert.deepEqual([c.status(1)?.estado, c.motivo(1), c.status(2)?.estado], ["falhou", "x", "aberto"]);
});

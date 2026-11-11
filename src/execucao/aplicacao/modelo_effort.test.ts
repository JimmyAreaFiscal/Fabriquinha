import assert from "node:assert/strict";
import { test } from "node:test";
import type { TicketDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import type { Projeto } from "../../projeto/nucleo/projeto.ts";
import { resolverModeloEffort } from "./modelo_effort.ts";

const modeloDoTicket = { provedor: "anthropic", nome: "opus" };
const modeloDaEtapa = { provedor: "openai", nome: "gpt" };
const etapas: Projeto["etapas"] = [
  { etapa: "planejar", configuracao_agente: { modelo: modeloDaEtapa, effort: "high" } },
  { etapa: "implementar" },
];
const ticket = (etapa: TicketDemanda["etapa"], configuracao_agente?: TicketDemanda["configuracao_agente"]) =>
  ({ etapa, ...(configuracao_agente && { configuracao_agente }) }) as TicketDemanda;

test("D07: o modelo e o effort do ticket vencem, campo a campo, os da etapa do projeto", () => {
  assert.deepEqual(resolverModeloEffort(ticket("planejar", { modelo: modeloDoTicket }), etapas), {
    modelo: modeloDoTicket,
    effort: "high",
  });
});

test("D07: sem configuração no ticket vale a da etapa; sem ela, nada (o padrão é o do harness)", () => {
  assert.deepEqual(resolverModeloEffort(ticket("planejar"), etapas), { modelo: modeloDaEtapa, effort: "high" });
  assert.deepEqual(resolverModeloEffort(ticket("implementar"), etapas), { modelo: undefined, effort: undefined });
  assert.deepEqual(resolverModeloEffort(ticket("entender_e_desenhar"), etapas), {
    modelo: undefined,
    effort: undefined,
  });
});

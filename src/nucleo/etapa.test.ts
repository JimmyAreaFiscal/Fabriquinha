import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_DE_ETAPAS } from "./etapa.ts";
import { catalogoDaEtapa } from "./evidencia_etapa.ts";
import { EtapaTicket } from "./primitivos.ts";

// A tabela Etapa × Executor × Escopo do CONCEITOS.md §2: Não Gerenciado = externo, Fabriquinha = fabriquinha,
// Gerenciado = agente_autonomo, Gerenciado (interativo) = agente_interativo.
const TABELA_DO_CONCEITOS = {
  entender_e_desenhar: ["externo", "demanda"],
  planejar: ["agente_interativo", "demanda"],
  implementar: ["agente_autonomo", "rodada"],
  revisar_rodada: ["agente_autonomo", "rodada"],
  encerrar_rodada: ["agente_autonomo", "rodada"],
  revisar_demanda: ["agente_autonomo", "demanda"],
  encerrar_demanda: ["fabriquinha", "demanda"],
  resolver_conflito: ["agente_autonomo", "demanda"],
  ajustar_resultado: ["agente_interativo", "rodada"],
};

test("o catálogo tem as 9 etapas e o executor e o escopo de cada uma batem com o CONCEITOS.md §2", () => {
  assert.deepEqual(Object.keys(CATALOGO_DE_ETAPAS).sort(), Object.keys(TABELA_DO_CONCEITOS).sort());
  assert.deepEqual(Object.keys(CATALOGO_DE_ETAPAS).sort(), [...EtapaTicket.options].sort());
  assert.deepEqual(
    Object.fromEntries(Object.values(CATALOGO_DE_ETAPAS).map((d) => [d.nome, [d.executor, d.escopo]])),
    TABELA_DO_CONCEITOS,
  );
});

test("a chave de cada definição é o nome dela, e as evidências são as da própria etapa", () => {
  for (const [chave, definicao] of Object.entries(CATALOGO_DE_ETAPAS)) {
    assert.equal(definicao.nome, chave);
    assert.ok(definicao.objetivo.length > 0);
    assert.ok(definicao.evidencias.every((e) => e.etapa === chave));
    assert.equal(catalogoDaEtapa(definicao.nome), definicao.evidencias);
  }
});

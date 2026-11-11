import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CATALOGO_DE_ETAPAS,
  etapaDoPapel,
  exigirEtapaConduzida,
  oAgenteDecideOGate,
  EtapaTicket,
  NomeGate,
} from "./catalogo.ts";
import { catalogoDaEtapa } from "./definicao/evidencia_exigida.ts";

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
  // O enum sai das chaves do catálogo, na ordem; os nomes vão ao banco e ao contrato, então ficam congelados aqui.
  assert.deepEqual(EtapaTicket.options, [
    "entender_e_desenhar",
    "planejar",
    "implementar",
    "revisar_rodada",
    "encerrar_rodada",
    "ajustar_resultado",
    "revisar_demanda",
    "encerrar_demanda",
    "resolver_conflito",
  ]);
  assert.deepEqual(Object.keys(CATALOGO_DE_ETAPAS), EtapaTicket.options);
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

test("exigirEtapaConduzida recusa só a etapa externa", () => {
  assert.throws(() => {
    exigirEtapaConduzida("entender_e_desenhar");
  }, /não tem condução/);
  for (const etapa of EtapaTicket.options.filter((e) => e !== "entender_e_desenhar")) exigirEtapaConduzida(etapa);
});

test("toda etapa conduzida tem o modo de trabalhar num .md que existe na pasta dela", () => {
  for (const definicao of Object.values(CATALOGO_DE_ETAPAS)) {
    if (definicao.nome === "entender_e_desenhar") {
      assert.equal(definicao.instrucao, undefined);
      continue;
    }
    assert.ok(definicao.instrucao, `${definicao.nome} sem instrucao`);
    const caminho = fileURLToPath(definicao.instrucao);
    assert.equal(dirname(caminho), join(import.meta.dirname, definicao.nome));
    assert.ok(existsSync(caminho), `${caminho} não existe`);
  }
});

test("cada papel do motor é de uma Etapa só, e as revisões são as Etapas cujo agente decide o Gate", () => {
  const papeis = Object.values(CATALOGO_DE_ETAPAS).flatMap((d) => (d.papel ? [[d.papel, d.nome] as const] : []));
  assert.deepEqual(Object.fromEntries(papeis), {
    planeja_a_demanda: "planejar",
    publica_o_pr_da_rodada: "encerrar_rodada",
    ajusta_o_pr_reprovado: "ajustar_resultado",
    integra_a_demanda: "encerrar_demanda",
    resolve_o_conflito_da_integracao: "resolver_conflito",
  });
  assert.equal(new Set(papeis.map(([papel]) => papel)).size, papeis.length);
  for (const [papel, etapa] of papeis) assert.equal(etapaDoPapel(papel), etapa);
  assert.deepEqual(EtapaTicket.options.filter(oAgenteDecideOGate), ["revisar_rodada", "revisar_demanda"]);
  assert.deepEqual(
    EtapaTicket.options.filter((etapa) => CATALOGO_DE_ETAPAS[etapa].devolveAoAgente),
    ["implementar", "resolver_conflito"],
  );
});

test("o enum NomeGate tem os Gates que as Etapas declaram, um por Etapa, com os nomes de sempre", () => {
  const gates = Object.values(CATALOGO_DE_ETAPAS).flatMap((d) => (d.gate ? [d.gate.nome] : []));
  assert.deepEqual(NomeGate.options, gates);
  // Os nomes vão às Decisões gravadas e ao contrato, então ficam congelados aqui.
  assert.deepEqual([...NomeGate.options].sort(), [
    "gate_demanda",
    "gate_planejamento",
    "gate_pr",
    "gate_revisao_demanda",
    "gate_revisao_rodada",
  ]);
});

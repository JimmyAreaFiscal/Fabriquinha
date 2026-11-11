import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CATALOGO_DE_ETAPAS, exigirEtapaConduzida } from "./catalogo.ts";
import { catalogoDaEtapa } from "./definicao/evidencia_exigida.ts";
import { EtapaTicket } from "../compartilhado/nucleo/primitivos.ts";

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

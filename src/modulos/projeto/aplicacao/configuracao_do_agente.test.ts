import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { configuracao } from "../../compartilhado/armazenamento/servico.ts";
import {
  configuracoesDasEtapas,
  etapasComModeloOuEffort,
  parDoModelo,
  validarESalvarConfiguracao,
} from "./configuracao_do_agente.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
test("validarESalvarConfiguracao grava a configuração validada e recusa o modelo da Avaliação, que saiu (ticket 02)", () => {
  const { banco } = abrirBancoTemporario();
  const nova = { ...configuracao(banco), intervaloMin: 7 };
  assert.deepEqual(validarESalvarConfiguracao(banco, nova), nova);
  assert.deepEqual(configuracao(banco), nova);
  assert.throws(() => validarESalvarConfiguracao(banco, { ...nova, intervaloMin: 9, modeloAuditoria: null }), ZodError);
  assert.deepEqual(configuracao(banco), nova, "a recusa não gravou nada");
  banco.close();
});

test("as etapas do projeto passam entre o cadastro e o formulário: só as com modelo ou effort", () => {
  const opus = { provedor: "anthropic", nome: "claude-opus-5-5" };
  const etapas = [
    { etapa: "planejar" as const, configuracao_agente: { modelo: opus, effort: "high" as const } },
    { etapa: "implementar" as const },
  ];
  assert.deepEqual(configuracoesDasEtapas(etapas), { planejar: etapas[0]?.configuracao_agente });
  assert.deepEqual(etapasComModeloOuEffort({ planejar: etapas[0]?.configuracao_agente, revisar_rodada: {} }), [
    etapas[0],
  ]);
  assert.equal(parDoModelo(opus), "anthropic/claude-opus-5-5");
  assert.equal(parDoModelo(null), undefined);
});

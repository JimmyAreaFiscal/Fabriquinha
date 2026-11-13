import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { configuracao } from "../armazenamento/configuracao_do_servico.ts";
import { validarESalvarConfiguracao } from "./configuracao_do_servico.ts";

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

// Configuração do serviço (F4 §3, §10).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { fabricaDeBancosTemporarios } from "../../apoio-testes/banco_temporario.ts";
import {
  configuracao,
  configuracaoDoAmbiente,
  limiteParalelismo,
  salvarConfiguracao,
  salvarConfiguracaoDoAmbiente,
} from "./servico.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const AMBIENTE_PADRAO = {
  tipo: "host_local",
  memoria_maxima_mb: 2048,
  cpus: 2,
  ociosidade_para_eliminar_min: 60,
};
const novoBanco = () => abrirBancoTemporario().banco;

test("configuração: linha única, agendador desligado por padrão, salvar validado por zod", () => {
  const banco = novoBanco();
  assert.deepEqual(configuracao(banco), {
    agendadorAtivo: false,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
    modeloAuditoria: null,
  });

  const nova = {
    agendadorAtivo: true,
    intervaloMin: 1,
    timeoutMin: 1440,
    ociosidadeMin: 5,
    modeloAuditoria: { provedor: "anthropic", nome: "claude-opus-5-5" },
  };
  assert.deepEqual(salvarConfiguracao(banco, nova), nova);
  assert.deepEqual(configuracao(banco), nova);
  // Campo ausente volta ao padrão do schema.
  assert.deepEqual(salvarConfiguracao(banco, { agendadorAtivo: true }), {
    agendadorAtivo: true,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
    modeloAuditoria: null, // o modelo da Auditoria também volta ao padrão do pi
  });

  for (const errada of [
    { modeloAuditoria: { provedor: "anthropic" } },
    { modeloAuditoria: { provedor: "Maiúscula", nome: "m" } },
    { intervaloMin: 0 },
    { timeoutMin: 9 },
    { ociosidadeMin: 1441 },
    { intervaloMin: 1.5 },
  ]) {
    assert.throws(() => salvarConfiguracao(banco, errada), ZodError);
  }
  assert.equal(configuracao(banco).agendadorAtivo, true, "a rejeitada não gravou nada");
  assert.throws(() => {
    banco.exec("INSERT INTO configuracao (id) VALUES (2)");
  }, /CHECK constraint/);
  banco.close();
});

test("CA-6: limite de paralelismo tem padrão 4 e é lido da coluna própria", () => {
  const banco = novoBanco();
  assert.equal(limiteParalelismo(banco), 4);
  banco.prepare("UPDATE configuracao SET limite_paralelismo = 3").run();
  assert.equal(limiteParalelismo(banco), 3);
  assert.equal(configuracao(banco).intervaloMin, 5, "o limite fica fora de `Configuracao`");
  banco.close();
});

test("configuração do Ambiente: host_local por padrão, gravada à parte da Configuração, validada por zod", () => {
  const banco = novoBanco();
  assert.deepEqual(configuracaoDoAmbiente(banco), AMBIENTE_PADRAO);

  const nova = { tipo: "container", memoria_maxima_mb: 512, cpus: 0.5, ociosidade_para_eliminar_min: 5 };
  assert.deepEqual(salvarConfiguracaoDoAmbiente(banco, nova), nova);
  assert.deepEqual(configuracaoDoAmbiente(banco), nova);
  salvarConfiguracao(banco, { agendadorAtivo: true });
  assert.deepEqual(configuracaoDoAmbiente(banco), nova, "a web grava a Configuração sem tocar no Ambiente");
  assert.deepEqual(salvarConfiguracaoDoAmbiente(banco, {}), AMBIENTE_PADRAO, "campo ausente volta ao padrão");

  for (const errada of [{ tipo: "vm" }, { memoria_maxima_mb: 511 }, { cpus: 0 }, { ociosidade_para_eliminar_min: 4 }])
    assert.throws(() => salvarConfiguracaoDoAmbiente(banco, errada), ZodError);
  assert.deepEqual(configuracaoDoAmbiente(banco), AMBIENTE_PADRAO, "a rejeitada não gravou nada");
  banco.close();
});

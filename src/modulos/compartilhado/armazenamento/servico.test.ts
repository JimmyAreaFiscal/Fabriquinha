// Configuração do serviço (F4 §3, §10).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { Configuracao, configuracao, limiteParalelismo, salvarConfiguracao } from "./servico.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const novoBanco = () => abrirBancoTemporario().banco;

test("configuração: linha única, agendador desligado por padrão, salva o tipo já validado", () => {
  const banco = novoBanco();
  assert.deepEqual(configuracao(banco), {
    agendadorAtivo: false,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
  });

  const nova = {
    agendadorAtivo: true,
    intervaloMin: 1,
    timeoutMin: 1440,
    ociosidadeMin: 5,
  };
  assert.deepEqual(salvarConfiguracao(banco, nova), nova);
  assert.deepEqual(configuracao(banco), nova);
  assert.throws(() => {
    banco.exec("INSERT INTO configuracao (id) VALUES (2)");
  }, /CHECK constraint/);
  banco.close();
});

test("o schema da Configuração completa o que falta com o padrão e recusa o inválido", () => {
  assert.deepEqual(Configuracao.parse({ agendadorAtivo: true }), {
    agendadorAtivo: true,
    intervaloMin: 5,
    timeoutMin: 120,
    ociosidadeMin: 30,
  });
  for (const errada of [
    // O modelo da Avaliação saiu com ela (ticket 02).
    { modeloAuditoria: { provedor: "anthropic", nome: "claude-opus-5-5" } },
    { intervaloMin: 0 },
    { timeoutMin: 9 },
    { ociosidadeMin: 1441 },
    { intervaloMin: 1.5 },
  ]) {
    assert.throws(() => Configuracao.parse(errada), ZodError);
  }
});

test("CA-6: limite de paralelismo tem padrão 4 e é lido da coluna própria", () => {
  const banco = novoBanco();
  assert.equal(limiteParalelismo(banco), 4);
  banco.prepare("UPDATE configuracao SET limite_paralelismo = 3").run();
  assert.equal(limiteParalelismo(banco), 3);
  assert.equal(configuracao(banco).intervaloMin, 5, "o limite fica fora de `Configuracao`");
  banco.close();
});

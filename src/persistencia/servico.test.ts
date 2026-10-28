// Configuração do serviço (F4 §3, §10).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ZodError } from "zod";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abrir } from "./banco.ts";
import { alterarLimiteParalelismo, configuracao, limiteParalelismo, salvarConfiguracao } from "./servico.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-servico-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const novoBanco = () => abrir(mkdtempSync(join(base, "raiz-")));

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
    modeloAuditoria: { provedor: "anthropic", modelo: "claude-opus-5-5" },
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
    { modeloAuditoria: { provedor: "Maiúscula", modelo: "m" } },
    { intervaloMin: 0 },
    { timeoutMin: 9 },
    { ociosidadeMin: 1441 },
    { intervaloMin: 1.5 },
  ]) {
    assert.throws(() => salvarConfiguracao(banco, errada), ZodError);
  }
  assert.equal(configuracao(banco).agendadorAtivo, true, "a recusada não gravou nada");
  assert.throws(() => {
    banco.exec("INSERT INTO configuracao (id) VALUES (2)");
  }, /CHECK constraint/);
  banco.close();
});

test("CA-6, CA-7, CA-8: limite de paralelismo tem padrão, altera e recusa inválido", () => {
  const banco = novoBanco();
  assert.equal(limiteParalelismo(banco), 4);
  alterarLimiteParalelismo(banco, 3);
  alterarLimiteParalelismo(banco, 5);
  assert.equal(limiteParalelismo(banco), 5);
  alterarLimiteParalelismo(banco, 3);
  for (const ruim of [0, -1, 1.5, "dois"]) {
    assert.throws(() => {
      alterarLimiteParalelismo(banco, ruim as number);
    }, ErroDeRegra);
  }
  assert.equal(limiteParalelismo(banco), 3);
  assert.equal(configuracao(banco).intervaloMin, 5, "só a coluna do limite muda");
  banco.close();
});

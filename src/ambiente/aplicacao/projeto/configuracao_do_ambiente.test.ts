import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ZodError } from "zod";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso } from "../../../../apoio-testes/pi_falso.ts";
import { configuracao, configuracaoDoAmbiente } from "../../../compartilhado/armazenamento/servico.ts";
import {
  conferirESalvarConfiguracao,
  configuracoesDasEtapas,
  etapasComModeloOuEffort,
  parDoModelo,
  validarESalvarConfiguracaoDoAmbiente,
} from "./configuracao_do_ambiente.ts";
import { HarnessPi } from "../../../harness/pi/harness_pi.ts";
import type { Modelo } from "../../../compartilhado/nucleo/primitivos.ts";

/** O pi falso do teste responde a conferência, como o harness do serviço. */
const conferirModeloNoPi = (modelo: Modelo): Promise<void> => new HarnessPi().conferirModelo(modelo);

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const PADRAO = { tipo: "host_local", memoria_maxima_mb: 2048, cpus: 2, ociosidade_para_eliminar_min: 60 };

test("validarESalvarConfiguracaoDoAmbiente completa o que falta com o padrão e recusa o inválido sem gravar", () => {
  const { banco } = abrirBancoTemporario();
  const nova = { tipo: "container", memoria_maxima_mb: 512, cpus: 0.5, ociosidade_para_eliminar_min: 5 };
  assert.deepEqual(validarESalvarConfiguracaoDoAmbiente(banco, nova), nova);
  assert.deepEqual(configuracaoDoAmbiente(banco), nova);
  assert.deepEqual(validarESalvarConfiguracaoDoAmbiente(banco, { tipo: "container" }), {
    ...PADRAO,
    tipo: "container",
  });

  for (const errada of [{ tipo: "vm" }, { memoria_maxima_mb: 511 }, { cpus: 0 }, { ociosidade_para_eliminar_min: 4 }])
    assert.throws(() => validarESalvarConfiguracaoDoAmbiente(banco, errada), ZodError);
  assert.equal(configuracaoDoAmbiente(banco).tipo, "container", "a rejeitada não gravou nada");
  banco.close();
});

test("conferirESalvarConfiguracao grava o modelo de auditoria que o pi lista, recusa o que ele não lista e não chama o pi para o igual ao gravado", async () => {
  const piFalso = instalarPiFalso(mkdtempSync(join(tmpdir(), "fabriquinha-config-ambiente-")));
  piFalso.roteirizar([
    {
      listaDeModelos: {
        tabela:
          "provider   model              context  max-out  thinking  images\n" +
          "anthropic  claude-opus-5-5    200K     64K      yes       yes\n",
      },
    },
  ]);
  const { banco } = abrirBancoTemporario();
  const opus = { provedor: "anthropic", nome: "claude-opus-5-5" };
  const nova = { ...configuracao(banco), intervaloMin: 7, modeloAuditoria: opus };
  assert.deepEqual(await conferirESalvarConfiguracao(banco, nova, conferirModeloNoPi), nova);
  assert.deepEqual(configuracao(banco), nova);

  await assert.rejects(
    conferirESalvarConfiguracao(
      banco,
      {
        ...nova,
        intervaloMin: 9,
        modeloAuditoria: { provedor: "inexistente", nome: "xyz" },
      },
      conferirModeloNoPi,
    ),
    (erro: unknown) =>
      erro instanceof ZodError &&
      erro.issues[0]?.path.join(".") === "modeloAuditoria" &&
      erro.issues[0].message.includes("o modelo inexistente/xyz não existe no pi"),
  );
  assert.deepEqual(configuracao(banco), nova, "a recusa não gravou nada");

  // Igual ao gravado: o pi nem é chamado (aqui, quebrado); sem modelo, volta ao padrão.
  piFalso.roteirizar([{ listaDeModelos: { codigo: 1 } }]);
  assert.equal(
    (await conferirESalvarConfiguracao(banco, { ...nova, intervaloMin: 8 }, conferirModeloNoPi)).intervaloMin,
    8,
  );
  assert.equal(
    (await conferirESalvarConfiguracao(banco, { ...nova, modeloAuditoria: null }, conferirModeloNoPi)).modeloAuditoria,
    null,
  );
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

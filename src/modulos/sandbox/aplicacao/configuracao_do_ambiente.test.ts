import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { configuracaoDoAmbiente } from "../armazenamento/configuracao_do_ambiente.ts";
import { relogioDoSistema } from "../../compartilhado/nucleo/relogio.ts";
import { ConjuntoDeAmbientes } from "./conjunto_de_ambientes/conjunto.ts";
import { conjuntoDoTipoConfigurado, validarESalvarConfiguracaoDoAmbiente } from "./configuracao_do_ambiente.ts";

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

test("conjuntoDoTipoConfigurado relê o tipo a cada pergunta: sem conjunto no host local, o mesmo conjunto no container", () => {
  const { banco } = abrirBancoTemporario();
  const servico = {
    raiz: "/r",
    porta_da_api: 1,
    home_do_usuario: "/h",
    pacote_do_harness: "/p",
    dir_do_harness_do_auditor: "/a",
  };
  const conjuntoDoBanco = conjuntoDoTipoConfigurado(relogioDoSistema, servico);
  assert.equal(conjuntoDoBanco(banco), undefined);
  validarESalvarConfiguracaoDoAmbiente(banco, { tipo: "container" });
  const conjunto = conjuntoDoBanco(banco);
  assert.ok(conjunto instanceof ConjuntoDeAmbientes);
  assert.equal(conjuntoDoBanco(banco), conjunto);
  validarESalvarConfiguracaoDoAmbiente(banco, { tipo: "host_local" });
  assert.equal(conjuntoDoBanco(banco), undefined);
  banco.close();
});

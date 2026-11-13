import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { validarESalvarConfiguracaoDoAmbiente } from "../../configuracao/publico.ts";
import { ConjuntoDeAmbientes } from "./conjunto_de_ambientes.ts";
import { conjuntoDoTipoConfigurado } from "./conjunto_do_tipo_configurado.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

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

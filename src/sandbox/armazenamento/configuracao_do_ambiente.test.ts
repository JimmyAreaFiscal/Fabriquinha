import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../apoio-testes/banco_temporario.ts";
import { Configuracao, salvarConfiguracao } from "../../compartilhado/armazenamento/servico.ts";
import type { ConfiguracaoDoAmbiente } from "../nucleo/configuracao_do_ambiente.ts";
import { configuracaoDoAmbiente, salvarConfiguracaoDoAmbiente } from "./configuracao_do_ambiente.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const AMBIENTE_PADRAO: ConfiguracaoDoAmbiente = {
  tipo: "host_local",
  memoria_maxima_mb: 2048,
  cpus: 2,
  ociosidade_para_eliminar_min: 60,
};
const novoBanco = () => abrirBancoTemporario().banco;

test("configuração do Ambiente: host_local por padrão, gravada à parte da Configuração", () => {
  const banco = novoBanco();
  assert.deepEqual(configuracaoDoAmbiente(banco), AMBIENTE_PADRAO);

  const nova: ConfiguracaoDoAmbiente = {
    tipo: "container",
    memoria_maxima_mb: 512,
    cpus: 0.5,
    ociosidade_para_eliminar_min: 5,
  };
  assert.deepEqual(salvarConfiguracaoDoAmbiente(banco, nova), nova);
  assert.deepEqual(configuracaoDoAmbiente(banco), nova);
  salvarConfiguracao(banco, Configuracao.parse({ agendadorAtivo: true }));
  assert.deepEqual(configuracaoDoAmbiente(banco), nova, "a web grava a Configuração sem tocar no Ambiente");
  banco.close();
});

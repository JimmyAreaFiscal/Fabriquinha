import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { Configuracao, salvarConfiguracao } from "../../../ciclo_de_vida/publico.ts";
import type { ConfiguracaoDoAmbiente } from "../nucleo/configuracao_do_ambiente.ts";
import { configuracaoDoAmbiente, salvarConfiguracaoDoAmbiente } from "./configuracao_do_ambiente.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const AMBIENTE_PADRAO: ConfiguracaoDoAmbiente = {
  tipo: "host_local",
  memoria_maxima_mb: 2048,
  cpus: 2,
  ociosidade_para_eliminar_min: 60,
  conjunto: "variavel",
  capacidade_do_conjunto: null,
  minimo_do_conjunto: 0,
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
    conjunto: "fixo",
    capacidade_do_conjunto: 4,
    minimo_do_conjunto: 1,
  };
  assert.deepEqual(salvarConfiguracaoDoAmbiente(banco, nova), nova);
  assert.deepEqual(configuracaoDoAmbiente(banco), nova);
  salvarConfiguracao(banco, Configuracao.parse({ agendadorAtivo: true }));
  assert.deepEqual(configuracaoDoAmbiente(banco), nova, "a web grava a Configuração sem tocar no Ambiente");
  banco.close();
});

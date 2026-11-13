import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../apoio-testes/banco_temporario.ts";
import { cadastrarProjetoLoja } from "../../../apoio-testes/cenarios_de_demanda.ts";
import { ErroDeInexistente } from "../../modulos/compartilhado/nucleo/erros.ts";
import { inserirAmbienteAlocado } from "../../modulos/sandbox/armazenamento/ambientes.ts";
import { gravarProjeto, projetoExistente } from "../../modulos/projeto/armazenamento/projetos.ts";
import { EstadoDaConfiguracao, EstadoDoAmbiente, ProjetoCadastrado } from "../contrato/configuracao.ts";
import {
  consultarEstadoDaConfiguracao,
  consultarEstadoDoAmbiente,
  consultarProjetoCadastrado,
  consultarProjetosCadastrados,
} from "./configuracao.ts";

const PROXIMA = new Date("2026-10-12T14:35:00.000Z");

test("a configuração só traz a próxima busca com o agendador ligado, e cumpre o contrato", () => {
  const { banco } = abrirBancoTemporario();
  const desligado = consultarEstadoDaConfiguracao(banco, () => PROXIMA);
  assert.equal(desligado.proximaBusca, null);
  banco.exec("UPDATE configuracao SET agendador_ativo = 1");
  const ligado = consultarEstadoDaConfiguracao(banco, () => PROXIMA);
  assert.equal(ligado.proximaBusca, "2026-10-12T14:35:00.000Z");
  assert.deepEqual(EstadoDaConfiguracao.parse(ligado), ligado);
});

test("o ambiente traz os limites gravados e o conjunto de containers, e cumpre o contrato", () => {
  const { banco } = abrirBancoTemporario();
  inserirAmbienteAlocado(banco, {
    id: "a1",
    container_id: "c1",
    imagem: "img",
    criado_em: "2026-10-12T14:00:00.000Z",
    alocado_para: "I-1",
  });
  const estado = consultarEstadoDoAmbiente(banco);
  assert.equal(estado.configuracao.tipo, "host_local");
  assert.deepEqual(
    estado.conjunto.map((a) => [a.id, a.estado, a.alocado_para]),
    [["a1", "alocado", "I-1"]],
  );
  assert.deepEqual(EstadoDoAmbiente.parse(estado), estado);
  assert.equal(banco.isTransaction, false);
});

test("os projetos trazem o modelo e o effort de cada etapa; o que não existe é ErroDeInexistente", () => {
  const { banco } = abrirBancoTemporario();
  assert.deepEqual(consultarProjetosCadastrados(banco), []);
  cadastrarProjetoLoja(banco);
  gravarProjeto(banco, {
    ...projetoExistente(banco, "loja"),
    etapas: [{ etapa: "implementar", configuracao_agente: { effort: "low" } }],
  });
  const loja = consultarProjetoCadastrado(banco, "loja");
  assert.deepEqual(loja.configuracoes, { implementar: { effort: "low" } });
  assert.deepEqual(consultarProjetosCadastrados(banco), [loja]);
  assert.deepEqual(ProjetoCadastrado.parse(loja), loja);
  assert.throws(() => consultarProjetoCadastrado(banco, "outro"), ErroDeInexistente);
});

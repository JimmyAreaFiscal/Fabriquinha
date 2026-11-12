import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco_temporario.ts";
import { cadastrarProjetoLoja } from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { ErroDeInexistente } from "../../../../modulos/compartilhado/nucleo/erros.ts";
import { gravarProjeto, projetoExistente } from "../../../../modulos/projeto/armazenamento/projetos.ts";
import { ConfiguracaoSdlcDoProjeto } from "../../../contrato/sdlc.ts";
import { consultarConfiguracaoSdlc } from "./sdlc.ts";

const SHA = "a".repeat(40);

test("sem linguagem o projeto não está configurado, e sem varredura não há cursor", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  const consulta = consultarConfiguracaoSdlc(banco, "loja");
  assert.equal(consulta.configurada, false);
  assert.equal("cursor_commit_humano" in consulta, false);
  assert.deepEqual(ConfiguracaoSdlcDoProjeto.parse(consulta), consulta);
  assert.equal(banco.isTransaction, false);
});

test("com linguagem o projeto está configurado, e o cursor da base vem junto", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  const loja = projetoExistente(banco, "loja");
  gravarProjeto(banco, {
    ...loja,
    verificacoes: { ...loja.verificacoes, linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "npm test" }] },
  });
  banco.exec(
    `INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES ('loja', '${SHA}', '2026-10-12T14:00:00.000Z')`,
  );
  const consulta = consultarConfiguracaoSdlc(banco, "loja");
  assert.equal(consulta.configurada, true);
  assert.equal(consulta.cursor_commit_humano, SHA);
  assert.deepEqual(ConfiguracaoSdlcDoProjeto.parse(consulta), consulta);
});

test("o projeto que não existe é ErroDeInexistente e não deixa transação aberta", () => {
  const { banco } = abrirBancoTemporario();
  assert.throws(() => consultarConfiguracaoSdlc(banco, "outro"), ErroDeInexistente);
  assert.equal(banco.isTransaction, false);
});

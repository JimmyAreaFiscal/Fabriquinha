// O fluxo do envio: o processo vai ao Gate da demanda e o pedido passa a `enviado` na mesma unidade de trabalho.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTORA_DOS_PEDIDOS,
  bancoComProjeto,
  completarDefinicao,
  CONTEXTO_DOS_PEDIDOS,
  OUTRA_SESSAO,
  pedidoEnviadoDeTeste,
  registrarPedidoDeTeste,
  situacaoGravada,
} from "../../../apoio-testes/pedidos_de_teste.ts";
import { ErroDeEscopo } from "../../shared/nucleo/erros.ts";
import { carregarDemanda } from "../../modulos/sdlc/armazenamento/demandas.ts";
import { enviarAoDesenvolvimento } from "./envio_ao_desenvolvimento.ts";

test("CA-14: com as obrigatórias, o processo vai ao Gate da demanda e o pedido fica enviado, com o conteúdo congelado", () => {
  const banco = bancoComProjeto();
  const id = registrarPedidoDeTeste(banco);
  completarDefinicao(banco, id);
  const processo = enviarAoDesenvolvimento(banco, id, AUTORA_DOS_PEDIDOS, CONTEXTO_DOS_PEDIDOS);
  assert.equal(processo.demanda.estado, "gate_demanda");
  assert.equal(carregarDemanda(banco, id).demanda.enviada, true);
  assert.equal(situacaoGravada(banco, id), "enviado");
});

test("CA-13: envio sem as obrigatórias lista as faltantes e deixa o pedido em rascunho", () => {
  const banco = bancoComProjeto();
  const id = registrarPedidoDeTeste(banco);
  assert.throws(
    () => enviarAoDesenvolvimento(banco, id, AUTORA_DOS_PEDIDOS, CONTEXTO_DOS_PEDIDOS),
    (erro: Error) => erro.message.includes("desenho_solucao"),
  );
  assert.equal(carregarDemanda(banco, id).demanda.enviada, false);
  assert.equal(situacaoGravada(banco, id), "rascunho");
});

test("CA-7: outra sessão não envia o pedido", () => {
  const banco = bancoComProjeto();
  const id = registrarPedidoDeTeste(banco);
  completarDefinicao(banco, id);
  assert.throws(() => enviarAoDesenvolvimento(banco, id, OUTRA_SESSAO, CONTEXTO_DOS_PEDIDOS), ErroDeEscopo);
  assert.equal(carregarDemanda(banco, id).demanda.estado, "entender_e_desenhar");
  assert.equal(situacaoGravada(banco, id), "rascunho");
});

test("o pedido já enviado não se envia de novo", () => {
  const banco = bancoComProjeto();
  const id = pedidoEnviadoDeTeste(banco);
  assert.throws(() => enviarAoDesenvolvimento(banco, id, AUTORA_DOS_PEDIDOS, CONTEXTO_DOS_PEDIDOS), /já foi enviada/);
});

test("atomicidade: a falha ao gravar a situação do pedido desfaz o avanço do processo", () => {
  const banco = bancoComProjeto();
  const id = registrarPedidoDeTeste(banco);
  completarDefinicao(banco, id);
  banco.exec(`CREATE TRIGGER falha_na_situacao BEFORE UPDATE OF situacao ON demanda WHEN NEW.situacao = 'enviado'
    BEGIN SELECT RAISE(ABORT, 'a situação falhou'); END`);
  assert.throws(
    () => enviarAoDesenvolvimento(banco, id, AUTORA_DOS_PEDIDOS, CONTEXTO_DOS_PEDIDOS),
    /a situação falhou/,
  );
  const { demanda } = carregarDemanda(banco, id);
  assert.deepEqual([demanda.estado, demanda.enviada], ["entender_e_desenhar", false]);
  assert.equal(situacaoGravada(banco, id), "rascunho");
  assert.equal(banco.isTransaction, false);
});

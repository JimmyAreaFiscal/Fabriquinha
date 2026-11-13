// Os casos de uso dos Pedidos num banco temporário: a edição do rascunho (CA-4 a CA-6) e a situação administrativa.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTORA_DOS_PEDIDOS,
  bancoComProjeto,
  OUTRA_SESSAO,
  pedidoEnviadoDeTeste,
  registrarPedidoDeTeste,
  situacaoGravada,
} from "../../../../../apoio-testes/pedidos_de_teste.ts";
import { ErroDeEscopo, ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import { lerPedido } from "../armazenamento/pedidos.ts";
import {
  editarPedido,
  enviarPedido,
  registrarCancelamentoDosPedidos,
  registrarConclusaoDoPedido,
} from "./gestao_de_pedidos.ts";

/** Os Pedidos sozinhos, sem o processo que o fluxo do servidor grava junto. */
const semProcesso = (): void => undefined;

test("CA-4: editar só o título mantém tipo e descrição; a edição vazia é recusada", () => {
  const banco = bancoComProjeto();
  const id = registrarPedidoDeTeste(banco);
  assert.equal(editarPedido(banco, id, { titulo: "Novo" }, AUTORA_DOS_PEDIDOS).titulo, "Novo");
  const { titulo, tipo, descricao } = lerPedido(banco, id);
  assert.deepEqual([titulo, tipo, descricao], ["Novo", "funcionalidade", "Desc"]);
  assert.throws(() => editarPedido(banco, id, {}, AUTORA_DOS_PEDIDOS), /informe ao menos um campo/);
  assert.throws(() => editarPedido(banco, id, { tipo: "outro" }, AUTORA_DOS_PEDIDOS), /^ErroDeRegra: tipo:/);
});

test("CA-5: o pedido enviado tem o conteúdo congelado", () => {
  const banco = bancoComProjeto();
  const id = pedidoEnviadoDeTeste(banco);
  assert.throws(() => editarPedido(banco, id, { descricao: "Outra" }, AUTORA_DOS_PEDIDOS), /congelado/);
  assert.equal(lerPedido(banco, id).descricao, "Desc");
});

test("CA-6: outra sessão não edita e o erro nomeia a sessão autora; o pedido inexistente dá ErroDeInexistente", () => {
  const banco = bancoComProjeto();
  const id = registrarPedidoDeTeste(banco);
  assert.throws(
    () => editarPedido(banco, id, { titulo: "X" }, OUTRA_SESSAO),
    (erro: Error) => erro instanceof ErroDeEscopo && erro.message.includes("S1"),
  );
  assert.equal(lerPedido(banco, id).titulo, "Titulo");
  assert.throws(() => editarPedido(banco, "I-999", { titulo: "X" }, AUTORA_DOS_PEDIDOS), ErroDeInexistente);
});

test("a situação vai de rascunho a enviado e a concluído; pedir a mesma situação não muda nada", () => {
  const banco = bancoComProjeto();
  const id = registrarPedidoDeTeste(banco);
  assert.throws(() => {
    registrarConclusaoDoPedido(banco, id, semProcesso);
  }, /está na situação rascunho e não pode passar a concluido/);
  enviarPedido(banco, id, semProcesso);
  assert.equal(situacaoGravada(banco, id), "enviado");
  registrarConclusaoDoPedido(banco, id, semProcesso);
  registrarConclusaoDoPedido(banco, id, semProcesso);
  assert.equal(situacaoGravada(banco, id), "concluido");
  assert.throws(() => {
    registrarCancelamentoDosPedidos(banco, [id]);
  }, /não pode passar a cancelado/);
});

test("o rascunho e o enviado se cancelam juntos; o cancelado não volta a ser enviado", () => {
  const banco = bancoComProjeto();
  const rascunho = registrarPedidoDeTeste(banco);
  const enviado = pedidoEnviadoDeTeste(banco);
  registrarCancelamentoDosPedidos(banco, [rascunho, enviado]);
  assert.deepEqual([situacaoGravada(banco, rascunho), situacaoGravada(banco, enviado)], ["cancelado", "cancelado"]);
  assert.throws(() => {
    enviarPedido(banco, rascunho, semProcesso);
  }, /não pode passar a enviado/);
});

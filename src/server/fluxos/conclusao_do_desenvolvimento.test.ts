// O fluxo da conclusão: o encerramento do processo e a conclusão do pedido gravados na mesma unidade de trabalho.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoComProjeto, pedidoEnviadoDeTeste, situacaoGravada } from "../../../apoio-testes/pedidos_de_teste.ts";
import { concluirDesenvolvimentoNoBanco } from "./conclusao_do_desenvolvimento.ts";

const concluirDesenvolvimento = (banco: ReturnType<typeof bancoComProjeto>, id: string, gravar: () => void) => {
  concluirDesenvolvimentoNoBanco(banco)(id, gravar);
};

const concluirOProcesso = (banco: ReturnType<typeof bancoComProjeto>, id: string) => () => {
  banco.prepare("UPDATE demanda SET estado = 'concluida' WHERE id = ?").run(id);
};
const concluirEsperandoFalha = (banco: ReturnType<typeof bancoComProjeto>, id: string, gravar: () => void) => () => {
  concluirDesenvolvimento(banco, id, gravar);
};

test("o processo concluído e o pedido concluído são gravados juntos; concluir de novo não muda nada", () => {
  const banco = bancoComProjeto();
  const id = pedidoEnviadoDeTeste(banco);
  concluirDesenvolvimento(banco, id, concluirOProcesso(banco, id));
  assert.equal(situacaoGravada(banco, id), "concluido");
  concluirDesenvolvimento(banco, id, concluirOProcesso(banco, id));
  assert.equal(situacaoGravada(banco, id), "concluido");
});

test("atomicidade: a falha ao gravar o encerramento do processo deixa o pedido enviado", () => {
  const banco = bancoComProjeto();
  const id = pedidoEnviadoDeTeste(banco);
  const encerramentoQueFalha = () => {
    throw new Error("o encerramento falhou");
  };
  assert.throws(concluirEsperandoFalha(banco, id, encerramentoQueFalha), /o encerramento falhou/);
  assert.equal(situacaoGravada(banco, id), "enviado");
});

test("atomicidade: a recusa do pedido desfaz o encerramento já gravado do processo", () => {
  const banco = bancoComProjeto();
  const id = pedidoEnviadoDeTeste(banco);
  banco.prepare("UPDATE demanda SET situacao = 'cancelado' WHERE id = ?").run(id);
  assert.throws(concluirEsperandoFalha(banco, id, concluirOProcesso(banco, id)), /não pode passar a concluido/);
  assert.equal(banco.prepare("SELECT estado FROM demanda WHERE id = ?").get(id)?.estado, "gate_demanda");
  assert.equal(banco.isTransaction, false);
});

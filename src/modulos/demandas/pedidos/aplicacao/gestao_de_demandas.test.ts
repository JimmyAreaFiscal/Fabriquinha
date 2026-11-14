// A GestaoDeDemandas: a conclusão grava o encerramento do processo e o pedido concluído na mesma unidade de trabalho, e a
// consulta traz o histórico, a origem e as relações de cada pedido.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bancoComProjeto,
  pedidoEnviadoDeTeste,
  situacaoGravada,
  registrarPedidoDeTeste,
} from "../../../../../apoio-testes/cenarios/pedidos_de_teste.ts";
import { montarDemandasDoBanco } from "../../../../server/system/banco_da_fabriquinha.ts";
import { ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";

const concluirDesenvolvimento = (banco: ReturnType<typeof bancoComProjeto>, id: string, gravar: () => void) => {
  montarDemandasDoBanco(banco).concluir(id, gravar);
};

const concluirOProcesso = (banco: ReturnType<typeof bancoComProjeto>, id: string) => () => {
  banco.prepare("UPDATE processo_demanda SET estado = 'concluida' WHERE demanda_id = ?").run(id);
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
  assert.equal(
    banco.prepare("SELECT estado FROM processo_demanda WHERE demanda_id = ?").get(id)?.estado,
    "gate_demanda",
  );
  assert.equal(banco.isTransaction, false);
});

test("a consulta traz cada pedido com o histórico, a origem e as relações; o filtro por projeto e o pedido inexistente", () => {
  const banco = bancoComProjeto({ comOutroProjeto: true });
  const demandas = montarDemandasDoBanco(banco);
  const a = registrarPedidoDeTeste(banco);
  const b = registrarPedidoDeTeste(banco, [a]);
  const c = registrarPedidoDeTeste(banco, [b], { projeto: "outro" });
  banco.exec(`INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em)
                VALUES ('av-1', 'fabriquinha', '2026-01-01', '2026-01-31', '', 't');
              INSERT INTO achado_avaliacao (avaliacao_id, achado_id, titulo, descricao, evidencia, demanda_id)
                VALUES ('av-1', 3, 'Achado', 'd', 'e', '${b}')`);
  const [lidoA, lidoB] = demandas.pedidos({ projeto: "fabriquinha" });
  assert.deepEqual(
    [lidoA?.id, lidoA?.dependentesPendentes, lidoA?.predecessoras, lidoA?.origem],
    [a, [b, c], [], undefined],
  );
  assert.deepEqual(
    [lidoB?.predecessoras, lidoB?.predecessorasPendentes, lidoB?.origem],
    [[a], [a], { avaliacao_id: "av-1", achado_id: 3, titulo: "Achado" }],
  );
  assert.equal(lidoA?.criadaEm, null);
  assert.equal(demandas.pedidos().length, 3);
  assert.deepEqual(demandas.pedido(c).predecessoras, [b]);
  assert.throws(() => demandas.pedido("I-999"), ErroDeInexistente);
});

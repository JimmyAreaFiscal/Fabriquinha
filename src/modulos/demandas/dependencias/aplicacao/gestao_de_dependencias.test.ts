// As Dependências num banco temporário: o registro da aresta (CA-2 a CA-6) e os dependentes que ainda não terminaram.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoComProjeto, registrarPedidoDeTeste } from "../../../../../apoio-testes/pedidos_de_teste.ts";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco_temporario.ts";
import { abrirBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { escrever } from "../../../../shared/armazenamento/banco.ts";
import { ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import { registrarPedidoComProcesso } from "../../../../server/fluxos/registro_do_pedido.ts";
import {
  dependentesNaoConcluidosDoPedido,
  predecessorasPendentesDosPedidos,
  registrarDependencia,
} from "./gestao_de_dependencias.ts";

const contarArestas = (banco: ReturnType<typeof bancoComProjeto>): unknown =>
  banco.prepare("SELECT count(*) AS n FROM dependencia_demanda").get()?.n;

test("CA-3: dependência que fecha ciclo é reprovada e nenhuma aresta nova é gravada", () => {
  const banco = bancoComProjeto();
  const b = registrarPedidoDeTeste(banco);
  const a = registrarPedidoDeTeste(banco, [b]);
  assert.throws(() => {
    registrarDependencia(banco, b, a);
  }, /ciclo de dependência/);
  assert.equal(contarArestas(banco), 1);
  registrarDependencia(banco, registrarPedidoDeTeste(banco), b);
  assert.equal(contarArestas(banco), 2);
});

test("CA-2 a CA-5: dependência recusada (enviada, autorreferência, repetida) não grava nada e fecha a transação", () => {
  const banco = bancoComProjeto();
  const a = registrarPedidoDeTeste(banco);
  const b = registrarPedidoDeTeste(banco, [a]);
  banco.exec(`UPDATE demanda SET enviada = 1 WHERE id = '${a}'`);
  assert.throws(() => {
    registrarDependencia(banco, a, b);
  }, /já foi enviada/);
  assert.throws(() => {
    registrarDependencia(banco, b, b);
  }, /não pode depender de si mesma/);
  assert.throws(() => {
    registrarDependencia(banco, b, a);
  }, /já depende/);
  assert.equal(contarArestas(banco), 1);
  assert.equal(banco.isTransaction, false);
});

test("dependência com pedido inexistente, dono ou predecessor, dá ErroDeInexistente", () => {
  const banco = bancoComProjeto();
  const id = registrarPedidoDeTeste(banco);
  assert.throws(() => {
    registrarDependencia(banco, "I-999", id);
  }, ErroDeInexistente);
  assert.throws(() => {
    registrarDependencia(banco, id, "I-999");
  }, ErroDeInexistente);
});

test("CA-11: os dependentes não terminados, entre projetos, pela situação do pedido", () => {
  const banco = bancoComProjeto({ comOutroProjeto: true });
  const a = registrarPedidoDeTeste(banco);
  const b = registrarPedidoDeTeste(banco, [a]);
  const c = registrarPedidoDeTeste(banco, [b], { projeto: "outro" });
  const concluido = registrarPedidoDeTeste(banco, [a]);
  banco.prepare("UPDATE demanda SET situacao = 'concluido' WHERE id = ?").run(concluido);
  assert.deepEqual(dependentesNaoConcluidosDoPedido(banco, a).toSorted(), [b, c]);
  assert.equal(banco.isTransaction, false);
});

test("dependentesNaoConcluidosDoPedido dentro de escrever não fecha a transação; outra conexão fica travada", () => {
  const { raiz, banco } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('fabriquinha', '/repo/f', 'main', 'github', 'k')`);
  const autor = { tipo: "externo", ferramenta: "claude", sessao: "S1" } as const;
  const conteudo = { projeto: "fabriquinha", titulo: "T", tipo: "funcionalidade", descricao: "D" };
  const ctx = { agora: "2026-01-01T00:00:00.000Z" };
  const [a, b] = [1, 2].map(() => registrarPedidoComProcesso(banco, conteudo, autor, ctx).demanda.id) as [
    string,
    string,
  ];
  const outra = abrirBancoDaFabriquinha(raiz);
  try {
    outra.exec("PRAGMA busy_timeout = 0");
    escrever(banco, () => {
      assert.deepEqual(dependentesNaoConcluidosDoPedido(banco, a), []);
      assert.equal(banco.isTransaction, true);
      assert.throws(() => {
        registrarDependencia(outra, b, a);
      }, /database is locked/);
    });
    assert.equal(banco.isTransaction, false);
    registrarDependencia(outra, b, a);
    assert.deepEqual(dependentesNaoConcluidosDoPedido(banco, a), [b]);
  } finally {
    outra.close();
  }
});

test("predecessorasPendentesDosPedidos: o pedido liberado não tem predecessora por concluir; lê fora e dentro de escrever", () => {
  const banco = bancoComProjeto();
  const concluido = registrarPedidoDeTeste(banco);
  const enviado = registrarPedidoDeTeste(banco);
  const dependente = registrarPedidoDeTeste(banco, [concluido, enviado]);
  const liberado = registrarPedidoDeTeste(banco, [concluido]);
  banco.prepare("UPDATE demanda SET situacao = 'concluido' WHERE id = ?").run(concluido);
  banco.prepare("UPDATE demanda SET situacao = 'enviado' WHERE id = ?").run(enviado);
  const esperado = [
    [dependente, [enviado]],
    [liberado, []],
  ];
  assert.deepEqual([...predecessorasPendentesDosPedidos(banco, [dependente, liberado])], esperado);
  assert.equal(banco.isTransaction, false);
  escrever(banco, () => {
    assert.deepEqual([...predecessorasPendentesDosPedidos(banco, [dependente, liberado])], esperado);
    assert.equal(banco.isTransaction, true);
  });
});

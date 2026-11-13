// O fluxo do registro: o pedido, o processo e as dependências nascem juntos, ou nada é gravado (CA-1 e CA-2).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTORA_DOS_PEDIDOS,
  bancoComProjeto,
  CONTEXTO_DOS_PEDIDOS,
  registrarPedidoDeTeste,
  situacaoGravada,
} from "../../../apoio-testes/cenarios/pedidos_de_teste.ts";
import { AUDITOR, carregarDemanda } from "../../modulos/ciclo_de_vida/publico.ts";
import { ErroDeInexistente, ErroDeRegra } from "../../shared/nucleo/erros.ts";
import { registrarPedidoComProcesso } from "./registro_do_pedido.ts";
import { montarDemandasDoBanco } from "../composicao/banco_da_fabriquinha.ts";

const contarLinhas = (banco: ReturnType<typeof bancoComProjeto>, tabela: string): unknown =>
  banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n;

test("CA-1: registra o pedido I-n em rascunho e o processo no estado da primeira Etapa, com a autora e sem evidência", () => {
  const banco = bancoComProjeto();
  const processo = registrarPedidoComProcesso(
    banco,
    montarDemandasDoBanco(banco),
    { projeto: "fabriquinha", titulo: "T", tipo: "funcionalidade", descricao: "D" },
    AUTORA_DOS_PEDIDOS,
    CONTEXTO_DOS_PEDIDOS,
  );
  assert.match(processo.demanda.id, /^I-\d+$/);
  assert.equal(processo.demanda.estado, "entender_e_desenhar");
  assert.deepEqual(processo.demanda.criada_por, AUTORA_DOS_PEDIDOS);
  assert.deepEqual(processo.tickets[0]?.criado_por, { tipo: "fabriquinha" });
  assert.deepEqual(processo.evidencias, []);
  assert.equal(carregarDemanda(banco, processo.demanda.id).demanda.titulo, "T");
  const {
    criadaEm: _,
    concluidaEm: __,
    predecessoras: ___,
    predecessorasPendentes: ____,
    dependentesPendentes: _____,
    ...lido
  } = montarDemandasDoBanco(banco).pedido(processo.demanda.id);
  assert.deepEqual(lido, {
    id: processo.demanda.id,
    projeto: "fabriquinha",
    titulo: "T",
    tipo: "funcionalidade",
    descricao: "D",
    criada_por: AUTORA_DOS_PEDIDOS,
    enviada: false,
    situacao: "rascunho",
  });
});

test("registrar recusa projeto inexistente e campo inválido com campo e correção", () => {
  const banco = bancoComProjeto();
  assert.throws(
    () =>
      registrarPedidoComProcesso(
        banco,
        montarDemandasDoBanco(banco),
        { projeto: "x", titulo: "T", tipo: "funcionalidade", descricao: "D" },
        AUTORA_DOS_PEDIDOS,
        CONTEXTO_DOS_PEDIDOS,
      ),
    ErroDeInexistente,
  );
  assert.throws(
    () =>
      registrarPedidoComProcesso(
        banco,
        montarDemandasDoBanco(banco),
        { projeto: "fabriquinha", titulo: "", tipo: "funcionalidade", descricao: "D" },
        AUTORA_DOS_PEDIDOS,
        CONTEXTO_DOS_PEDIDOS,
      ),
    (erro: Error) =>
      erro instanceof ErroDeRegra && erro.message.startsWith("titulo:") && erro.message.includes("corrija"),
  );
});

test("registrar recusa ator não externo sem gravar o pedido nem consumir o ID", () => {
  const banco = bancoComProjeto();
  assert.throws(() => registrarPedidoDeTeste(banco, [], { autor: AUDITOR as never }), ErroDeRegra);
  assert.equal(contarLinhas(banco, "demanda"), 0);
  assert.equal(registrarPedidoDeTeste(banco), "I-1");
});

test("CA-2: dependência em pedido inexistente recusa e não grava o pedido, o processo, a aresta nem o ID", () => {
  const banco = bancoComProjeto();
  assert.throws(() => registrarPedidoDeTeste(banco, ["I-999"]), /I-999 não existe/);
  for (const tabela of ["demanda", "ticket_demanda", "dependencia_demanda"])
    assert.equal(contarLinhas(banco, tabela), 0);
  const id = registrarPedidoDeTeste(banco);
  assert.equal(id, "I-1");
  assert.equal(situacaoGravada(banco, id), "rascunho");
});

test("o pedido nasce com as dependências registradas", () => {
  const banco = bancoComProjeto();
  const predecessora = registrarPedidoDeTeste(banco);
  const dependente = registrarPedidoDeTeste(banco, [predecessora]);
  const arestas = banco.prepare("SELECT demanda_id, depende_demanda_id FROM dependencia_demanda").all();
  assert.deepEqual(
    arestas.map((aresta) => ({ ...aresta })),
    [{ demanda_id: dependente, depende_demanda_id: predecessora }],
  );
});

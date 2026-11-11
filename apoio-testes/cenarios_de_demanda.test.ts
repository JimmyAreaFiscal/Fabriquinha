import assert from "node:assert/strict";
import { test } from "node:test";
import { EstadoDemanda } from "../src/compartilhado/nucleo/primitivos.ts";
import { carregarDemanda, criarDemandaNova } from "../src/demanda/armazenamento/demandas.ts";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import {
  agregadoComPullRequestAberto,
  agregadoEmRevisao,
  agregadoNoEstado,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
} from "./cenarios_de_demanda.ts";

const etapasEm = (estado: EstadoDemanda) =>
  agregadoNoEstado("I-9", estado).tickets.map((t) => `${t.etapa}:${t.estado}`);

test("cada estado do Ciclo de Vida tem um agregado que a persistência grava e devolve igual", () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    cadastrarProjetoLoja(banco);
    EstadoDemanda.options.forEach((estado, i) => {
      const agregado = agregadoNoEstado(`I-${String(10 + i)}`, estado);
      gravarAgregadoPronto(banco, agregado);
      assert.deepEqual(carregarDemanda(banco, agregado.demanda.id), agregado);
    });
  } finally {
    fechar();
  }
});

test("os tickets acompanham o avanço do Ciclo de Vida", () => {
  assert.deepEqual(etapasEm("entender_e_desenhar"), ["entender_e_desenhar:em_execucao"]);
  assert.deepEqual(etapasEm("planejar"), ["entender_e_desenhar:concluido", "planejar:aberto"]);
  assert.deepEqual(etapasEm("em_execucao"), [
    "entender_e_desenhar:concluido",
    "planejar:concluido",
    "implementar:aberto",
  ]);
  assert.deepEqual(etapasEm("revisar_demanda").slice(-2), ["implementar:concluido", "revisar_demanda:aberto"]);
  assert.deepEqual(etapasEm("encerrar_demanda").slice(-2), ["revisar_demanda:concluido", "encerrar_demanda:aberto"]);
  assert.equal(etapasEm("concluida").at(-1), "encerrar_demanda:concluido");
  assert.equal(etapasEm("cancelada").at(-1), "encerrar_demanda:cancelado");
  assert.equal(agregadoNoEstado("I-9", "entender_e_desenhar").demanda.enviada, false);
  assert.equal(agregadoNoEstado("I-9", "em_execucao").rodadas[0]?.estado, "implementar");
  assert.equal(agregadoNoEstado("I-9", "revisar_demanda").rodadas[0]?.estado, "concluida");
});

test("gravar o agregado pronto não mexe na sequência de IDs", () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    cadastrarProjetoLoja(banco);
    gravarAgregadoPronto(banco, agregadoNoEstado("I-206", "planejar"));
    assert.equal(banco.prepare("SELECT 1 FROM sequencia").get(), undefined);
    const nova = criarDemandaNova(banco, (id) => agregadoNoEstado(id, "entender_e_desenhar"));
    assert.equal(nova.demanda.id, "I-1");
    gravarAgregadoPronto(banco, agregadoNoEstado("I-5", "entender_e_desenhar"));
    assert.equal(banco.prepare("SELECT valor FROM sequencia WHERE nome = 'demanda'").get()?.valor, 1);
  } finally {
    fechar();
  }
});

test("os cenários da revisão e do PR aberto também são gravados", () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    cadastrarProjetoLoja(banco);
    for (const agregado of [agregadoEmRevisao(), agregadoComPullRequestAberto("I-206")]) {
      gravarAgregadoPronto(banco, agregado);
      assert.deepEqual(carregarDemanda(banco, agregado.demanda.id), agregado);
    }
    assert.equal(agregadoEmRevisao({ integral: true }).demanda.estado, "revisar_demanda");
    assert.equal(agregadoEmRevisao({ integral: true }).tickets[1]?.estado, "concluido");
  } finally {
    fechar();
  }
});

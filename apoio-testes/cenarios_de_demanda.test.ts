import assert from "node:assert/strict";
import { test } from "node:test";
import { FaseDemanda } from "../src/dominio/primitivos.ts";
import { carregarDemanda, criarDemandaNova } from "../src/persistencia/demandas.ts";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import {
  agregadoComPullRequestAberto,
  agregadoEmRevisao,
  agregadoNaFase,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
} from "./cenarios_de_demanda.ts";

const etapasEm = (fase: FaseDemanda) => agregadoNaFase("I-9", fase).tickets.map((t) => `${t.etapa}:${t.status}`);

test("cada fase do Ciclo de Vida tem um agregado que a persistência grava e devolve igual", () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    cadastrarProjetoLoja(banco);
    FaseDemanda.options.forEach((fase, i) => {
      const agregado = agregadoNaFase(`I-${String(10 + i)}`, fase);
      gravarAgregadoPronto(banco, agregado);
      assert.deepEqual(carregarDemanda(banco, agregado.demanda.id), agregado);
    });
  } finally {
    fechar();
  }
});

test("os tickets acompanham o avanço do Ciclo de Vida", () => {
  assert.deepEqual(etapasEm("registro"), ["demanda:em_execucao"]);
  assert.deepEqual(etapasEm("planejamento"), ["demanda:concluido", "planejar:aberto"]);
  assert.deepEqual(etapasEm("execucao"), ["demanda:concluido", "planejar:concluido", "implementar:aberto"]);
  assert.deepEqual(etapasEm("revisao_demanda").slice(-2), ["implementar:concluido", "revisar_demanda:aberto"]);
  assert.deepEqual(etapasEm("encerramento").slice(-2), ["revisar_demanda:concluido", "encerrar_demanda:aberto"]);
  assert.equal(etapasEm("concluida").at(-1), "encerrar_demanda:concluido");
  assert.equal(etapasEm("cancelada").at(-1), "encerrar_demanda:cancelado");
  assert.equal(agregadoNaFase("I-9", "registro").demanda.enviada, false);
  assert.equal(agregadoNaFase("I-9", "execucao").rodadas[0]?.fase, "desenvolvimento");
  assert.equal(agregadoNaFase("I-9", "revisao_demanda").rodadas[0]?.fase, "concluida");
});

test("gravar o agregado pronto não mexe na sequência de IDs", () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    cadastrarProjetoLoja(banco);
    gravarAgregadoPronto(banco, agregadoNaFase("I-206", "planejamento"));
    assert.equal(banco.prepare("SELECT 1 FROM sequencia").get(), undefined);
    const nova = criarDemandaNova(banco, (id) => agregadoNaFase(id, "registro"));
    assert.equal(nova.demanda.id, "I-1");
    gravarAgregadoPronto(banco, agregadoNaFase("I-5", "registro"));
    assert.equal(banco.prepare("SELECT valor FROM sequencia WHERE nome = 'issue'").get()?.valor, 1);
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
    assert.equal(agregadoEmRevisao({ integral: true }).demanda.fase, "revisao_demanda");
    assert.equal(agregadoEmRevisao({ integral: true }).tickets[1]?.status, "concluido");
  } finally {
    fechar();
  }
});

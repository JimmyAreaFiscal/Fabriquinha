// O fluxo do cancelamento em cascata (D08, CA-16 a CA-26): pedido, dependentes e processos são cancelados na mesma
// unidade de trabalho, e as execuções abertas só são interrompidas depois do commit.
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  bancoComProjeto,
  CONTEXTO_DOS_PEDIDOS,
  pedidoEnviadoDeTeste,
  registrarPedidoDeTeste,
  situacaoGravada,
} from "../../../apoio-testes/cenarios/pedidos_de_teste.ts";
import { carregarDemanda } from "../../../apoio-testes/ciclo_de_vida/ciclo_de_vida_internos.ts";
import { ErroDeRegra } from "../../shared/nucleo/erros.ts";
import { cancelarDemandaEmCascata, decidirGateDaDemanda } from "./cancelamento_em_cascata.ts";
import { montarDemandasDoBanco } from "../composicao/banco_da_fabriquinha.ts";
import {
  carregarSessoesDoContexto,
  comSessoesDoContexto,
  motorDoBanco,
} from "../../../apoio-testes/sessoes_de_teste.ts";
import { cicloDeVidaDeTeste } from "../../../apoio-testes/falsos/ambiente_falso.ts";
import { cicloDeVidaNoContexto } from "../../../apoio-testes/ciclo_de_vida/ciclo_de_vida_de_teste.ts";

const ctx = CONTEXTO_DOS_PEDIDOS;
const aprovar = { resultado: "aprovado" };
const reprovar = { resultado: "reprovado", motivo: "fora do escopo" };

const estado = (banco: DatabaseSync, id: string) => carregarDemanda(banco, id).demanda.estado;
/** Põe a demanda no estado do processo e na situação que o fluxo daria a ele. */
const terminarComo = (banco: DatabaseSync, id: string, estadoDoProcesso: string, situacao: string) => {
  banco.prepare("UPDATE processo_demanda SET estado = ? WHERE demanda_id = ?").run(estadoDoProcesso, id);
  banco.prepare("UPDATE demanda SET situacao = ? WHERE id = ?").run(situacao, id);
};
const colocarEmExecucao = (banco: DatabaseSync, id: string) => {
  banco.prepare("UPDATE processo_demanda SET estado = 'em_execucao' WHERE demanda_id = ?").run(id);
  banco.prepare("UPDATE demanda SET situacao = 'enviado' WHERE id = ?").run(id);
};
/** Abre uma execução sem pi no ar no ticket 1 da demanda `id`. */
function abrirExecucao(banco: DatabaseSync, id: string, sessao: string) {
  const ref = { demanda_id: id, ticket_id: 1 };
  comSessoesDoContexto(banco, ref, (x) => ({
    ...x,
    sessoes: [{ id: sessao, ...ref, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: `e-${sessao}`, trabalho_id: sessao, inicio: ctx.agora, falha: false }],
  }));
  return ref;
}

test("CA-16: aprovar o Gate da demanda leva ao planejamento, grava a decisão e não cascateia", () => {
  const banco = bancoComProjeto();
  const a = pedidoEnviadoDeTeste(banco);
  const dependente = registrarPedidoDeTeste(banco, [a]);
  const { demanda, canceladas } = decidirGateDaDemanda(
    cicloDeVidaDeTeste(banco),
    montarDemandasDoBanco(banco),
    a,
    aprovar,
  );
  assert.equal(demanda.demanda.estado, "planejar");
  assert.deepEqual(canceladas, []);
  assert.equal(demanda.decisoes[0]?.resultado, "aprovado");
  assert.deepEqual(
    [estado(banco, dependente), situacaoGravada(banco, dependente)],
    ["entender_e_desenhar", "rascunho"],
  );
  assert.equal(situacaoGravada(banco, a), "enviado");
});

test("CA-17: reprovar com motivo cancela o pedido, o processo e os dependentes elegíveis", () => {
  const banco = bancoComProjeto();
  const a = pedidoEnviadoDeTeste(banco);
  const dependente = registrarPedidoDeTeste(banco, [a]);
  const feita = registrarPedidoDeTeste(banco, [a]);
  terminarComo(banco, feita, "concluida", "concluido");
  const { demanda, canceladas } = decidirGateDaDemanda(
    cicloDeVidaDeTeste(banco),
    montarDemandasDoBanco(banco),
    a,
    reprovar,
  );
  assert.equal(demanda.demanda.estado, "cancelada");
  assert.deepEqual(canceladas, [a, dependente]);
  assert.deepEqual(
    [a, dependente, feita].map((id) => [estado(banco, id), situacaoGravada(banco, id)]),
    [
      ["cancelada", "cancelado"],
      ["cancelada", "cancelado"],
      ["concluida", "concluido"],
    ],
  );
});

test("CA-17: reprovar a demanda interrompe a execução aberta do dependente cancelado", () => {
  const banco = bancoComProjeto();
  const a = pedidoEnviadoDeTeste(banco);
  const ref = abrirExecucao(banco, registrarPedidoDeTeste(banco, [a]), "s1");
  decidirGateDaDemanda(cicloDeVidaDeTeste(banco), montarDemandasDoBanco(banco), a, reprovar);
  assert.ok(carregarSessoesDoContexto(banco, ref).execucoes[0]?.fim);
});

test("CA-18 e CA-20: a entrada inválida e a demanda em registro são recusadas sem mudar nada", () => {
  const banco = bancoComProjeto();
  const a = pedidoEnviadoDeTeste(banco);
  assert.throws(
    () => decidirGateDaDemanda(cicloDeVidaDeTeste(banco), montarDemandasDoBanco(banco), a, { resultado: "reprovado" }),
    /informe o motivo da reprovação/,
  );
  assert.throws(
    () => decidirGateDaDemanda(cicloDeVidaDeTeste(banco), montarDemandasDoBanco(banco), a, { resultado: "x" }),
    ErroDeRegra,
  );
  assert.deepEqual([estado(banco, a), situacaoGravada(banco, a)], ["gate_demanda", "enviado"]);
  const rascunho = registrarPedidoDeTeste(banco);
  assert.throws(
    () => decidirGateDaDemanda(cicloDeVidaDeTeste(banco), montarDemandasDoBanco(banco), rascunho, aprovar),
    /não espera decisão/,
  );
  assert.equal(estado(banco, rascunho), "entender_e_desenhar");
});

test("CA-21: cancelar leva dependentes diretos e indiretos de outros projetos e poupa os terminados", () => {
  const banco = bancoComProjeto({ comOutroProjeto: true });
  const a = registrarPedidoDeTeste(banco);
  const b = registrarPedidoDeTeste(banco, [a]);
  const c = registrarPedidoDeTeste(banco, [b], { projeto: "outro" });
  const d = registrarPedidoDeTeste(banco, [a]);
  const e = registrarPedidoDeTeste(banco, [a]);
  terminarComo(banco, d, "concluida", "concluido");
  terminarComo(banco, e, "arquivada", "concluido");
  colocarEmExecucao(banco, a);
  const { canceladas } = cancelarDemandaEmCascata(cicloDeVidaNoContexto(banco, ctx), montarDemandasDoBanco(banco), a);
  assert.deepEqual([...canceladas].sort(), [a, b, c].sort());
  assert.deepEqual(
    [a, b, c, d, e].map((id) => [estado(banco, id), situacaoGravada(banco, id)]),
    [
      ["cancelada", "cancelado"],
      ["cancelada", "cancelado"],
      ["cancelada", "cancelado"],
      ["concluida", "concluido"],
      ["arquivada", "concluido"],
    ],
  );
});

test("CA-22: a execução órfã de um dependente é interrompida e fica com o fim gravado; a alheia segue aberta", () => {
  const banco = bancoComProjeto();
  const a = registrarPedidoDeTeste(banco);
  const ref = abrirExecucao(banco, registrarPedidoDeTeste(banco, [a]), "s1");
  const refAlheia = abrirExecucao(banco, registrarPedidoDeTeste(banco), "s2");
  cancelarDemandaEmCascata(cicloDeVidaNoContexto(banco, ctx), montarDemandasDoBanco(banco), a);
  assert.equal(carregarSessoesDoContexto(banco, refAlheia).execucoes[0]?.fim, null);
  assert.ok(carregarSessoesDoContexto(banco, ref).execucoes[0]?.fim);
});

test("ordem: as execuções abertas só são interrompidas depois do commit do cancelamento", (t) => {
  const banco = bancoComProjeto();
  const a = registrarPedidoDeTeste(banco);
  abrirExecucao(banco, a, "s1");
  abrirExecucao(banco, registrarPedidoDeTeste(banco, [a]), "s2");
  const vistoNaInterrupcao: { emTransacao: boolean; situacao: unknown }[] = [];
  const interromperDeVerdade = motorDoBanco(banco).interromper.bind(motorDoBanco(banco));
  t.mock.method(motorDoBanco(banco), "interromper", (execucao: string) => {
    vistoNaInterrupcao.push({ emTransacao: banco.isTransaction, situacao: situacaoGravada(banco, a) });
    return interromperDeVerdade(execucao);
  });
  cancelarDemandaEmCascata(cicloDeVidaNoContexto(banco, ctx), montarDemandasDoBanco(banco), a);
  assert.deepEqual(vistoNaInterrupcao, [
    { emTransacao: false, situacao: "cancelado" },
    { emTransacao: false, situacao: "cancelado" },
  ]);
});

test("CA-24: a demanda terminada não se cancela", () => {
  const banco = bancoComProjeto();
  const a = registrarPedidoDeTeste(banco);
  terminarComo(banco, a, "concluida", "concluido");
  assert.throws(
    () => cancelarDemandaEmCascata(cicloDeVidaNoContexto(banco, ctx), montarDemandasDoBanco(banco), a),
    /já terminou/,
  );
  assert.deepEqual([estado(banco, a), situacaoGravada(banco, a)], ["concluida", "concluido"]);
});

test("CA-25: cancelar mantém decisões, evidências e execuções", () => {
  const banco = bancoComProjeto();
  const a = pedidoEnviadoDeTeste(banco);
  const ref = { demanda_id: a, ticket_id: 1 };
  comSessoesDoContexto(banco, ref, (x) => ({
    ...x,
    sessoes: [{ id: "s1", ...ref, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e1", trabalho_id: "s1", inicio: ctx.agora, falha: false, fim: ctx.agora }],
  }));
  decidirGateDaDemanda(cicloDeVidaDeTeste(banco), montarDemandasDoBanco(banco), a, aprovar);
  const antes = { processo: carregarDemanda(banco, a), execucoes: carregarSessoesDoContexto(banco, ref).execucoes };
  const { demanda } = cancelarDemandaEmCascata(cicloDeVidaNoContexto(banco, ctx), montarDemandasDoBanco(banco), a);
  assert.deepEqual(demanda.decisoes, antes.processo.decisoes);
  assert.deepEqual(demanda.evidencias, antes.processo.evidencias);
  assert.deepEqual(carregarSessoesDoContexto(banco, ref).execucoes, antes.execucoes);
});

test("CA-26 (atomicidade): a falha no processo de um dependente desfaz o pedido, os dependentes e os processos", () => {
  const banco = bancoComProjeto();
  const a = registrarPedidoDeTeste(banco);
  const b = registrarPedidoDeTeste(banco, [a]);
  const c = registrarPedidoDeTeste(banco, [a]);
  const ref = abrirExecucao(banco, b, "s1");
  banco.exec(`CREATE TRIGGER falha BEFORE UPDATE OF estado ON processo_demanda WHEN NEW.demanda_id = '${c}' AND NEW.estado = 'cancelada'
    BEGIN SELECT RAISE(ABORT, 'falhou'); END`);
  assert.throws(
    () => cancelarDemandaEmCascata(cicloDeVidaNoContexto(banco, ctx), montarDemandasDoBanco(banco), a),
    /falhou/,
  );
  assert.deepEqual(
    [a, b, c].map((id) => [estado(banco, id), situacaoGravada(banco, id)]),
    [
      ["entender_e_desenhar", "rascunho"],
      ["entender_e_desenhar", "rascunho"],
      ["entender_e_desenhar", "rascunho"],
    ],
  );
  assert.equal(carregarSessoesDoContexto(banco, ref).execucoes[0]?.fim, null);
});

test("atomicidade: a falha ao gravar a situação dos pedidos desfaz o cancelamento dos processos", () => {
  const banco = bancoComProjeto();
  const a = registrarPedidoDeTeste(banco);
  const b = registrarPedidoDeTeste(banco, [a]);
  banco.exec(`CREATE TRIGGER falha_na_situacao BEFORE UPDATE OF situacao ON demanda WHEN NEW.id = '${b}'
    BEGIN SELECT RAISE(ABORT, 'a situação falhou'); END`);
  assert.throws(
    () => cancelarDemandaEmCascata(cicloDeVidaNoContexto(banco, ctx), montarDemandasDoBanco(banco), a),
    /a situação falhou/,
  );
  assert.deepEqual(
    [a, b].map((id) => [estado(banco, id), situacaoGravada(banco, id)]),
    [
      ["entender_e_desenhar", "rascunho"],
      ["entender_e_desenhar", "rascunho"],
    ],
  );
  assert.equal(banco.isTransaction, false);
});

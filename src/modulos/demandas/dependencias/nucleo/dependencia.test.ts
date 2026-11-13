import assert from "node:assert/strict";
import { test } from "node:test";
import { type DependenciaDemanda, dependenciaNovaValidada, dependentesNaoConcluidos } from "./dependencia.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";

const aresta = (demanda_id: string, depende_demanda_id: string): DependenciaDemanda => ({
  demanda_id,
  depende_demanda_id,
});
const rascunho = (id: string) => ({ id, enviada: false });

test("CA-1: devolve a aresta nova", () => {
  assert.deepEqual(dependenciaNovaValidada([], rascunho("I-2"), "I-1"), aresta("I-2", "I-1"));
});

test("CA-2: recusa pedido enviado citando o id", () => {
  assert.throws(() => dependenciaNovaValidada([], { id: "I-2", enviada: true }, "I-1"), /I-2.*já foi enviada/);
});

test("CA-3: recusa autorreferência", () => {
  assert.throws(() => dependenciaNovaValidada([], rascunho("I-1"), "I-1"), ErroDeRegra);
});

test("recusa dependência repetida", () => {
  assert.throws(() => dependenciaNovaValidada([aresta("I-2", "I-1")], rascunho("I-2"), "I-1"), /já depende/);
});

test("CA-4: recusa ciclo direto apontando o caminho", () => {
  assert.throws(() => dependenciaNovaValidada([aresta("I-2", "I-1")], rascunho("I-1"), "I-2"), /ciclo/);
});

test("CA-5: recusa ciclo indireto", () => {
  const existentes = [aresta("I-2", "I-1"), aresta("I-3", "I-2")];
  assert.throws(() => dependenciaNovaValidada(existentes, rascunho("I-1"), "I-3"), /ciclo/);
});

test("CA-6: aceita diamante sem ciclo", () => {
  const existentes = [aresta("I-2", "I-1"), aresta("I-3", "I-1"), aresta("I-4", "I-2")];
  assert.deepEqual(dependenciaNovaValidada(existentes, rascunho("I-4"), "I-3"), aresta("I-4", "I-3"));
});

test("CA-11: dependentes diretos e indiretos que não terminaram, sem repetir e sem os de situação desconhecida", () => {
  const arestas = [
    aresta("I-2", "I-1"),
    aresta("I-3", "I-2"),
    aresta("I-4", "I-1"),
    aresta("I-3", "I-1"),
    aresta("I-8", "I-2"),
    aresta("I-9", "I-4"),
  ];
  const situacoes = new Map([
    ["I-2", "enviado"],
    ["I-3", "rascunho"],
    ["I-4", "concluido"],
    ["I-9", "cancelado"],
  ] as const);
  assert.deepEqual(dependentesNaoConcluidos(arestas, situacoes, "I-1").toSorted(), ["I-2", "I-3"]);
});

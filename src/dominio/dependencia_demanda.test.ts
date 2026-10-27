import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DependenciaDemanda,
  dependentesNaoConcluidas,
  exigirRemovivel,
  predecessorasPendentes,
  registrarDependencia,
} from "./dependencia_demanda.ts";
import { ErroDeRegra } from "./erros.ts";

const aresta = (demanda_id: string, depende_demanda_id: string): DependenciaDemanda => ({
  demanda_id,
  depende_demanda_id,
});
const livre = (id: string) => ({ id, enviada: false });

test("CA-1: devolve a aresta nova", () => {
  assert.deepEqual(registrarDependencia([], livre("I-2"), "I-1"), aresta("I-2", "I-1"));
});

test("CA-2: recusa demanda enviada citando o id", () => {
  assert.throws(() => registrarDependencia([], { id: "I-2", enviada: true }, "I-1"), /I-2.*já foi enviada/);
});

test("CA-3: recusa autorreferência", () => {
  assert.throws(() => registrarDependencia([], livre("I-1"), "I-1"), ErroDeRegra);
});

test("recusa dependência repetida", () => {
  assert.throws(() => registrarDependencia([aresta("I-2", "I-1")], livre("I-2"), "I-1"), /já depende/);
});

test("CA-4: recusa ciclo direto apontando o caminho", () => {
  assert.throws(() => registrarDependencia([aresta("I-2", "I-1")], livre("I-1"), "I-2"), /ciclo/);
});

test("CA-5: recusa ciclo indireto", () => {
  const existentes = [aresta("I-2", "I-1"), aresta("I-3", "I-2")];
  assert.throws(() => registrarDependencia(existentes, livre("I-1"), "I-3"), /ciclo/);
});

test("CA-6: aceita diamante sem ciclo", () => {
  const existentes = [aresta("I-2", "I-1"), aresta("I-3", "I-1"), aresta("I-4", "I-2")];
  assert.deepEqual(registrarDependencia(existentes, livre("I-4"), "I-3"), aresta("I-4", "I-3"));
});

test("CA-7: remove aresta existente de demanda não enviada", () => {
  assert.doesNotThrow(() => {
    exigirRemovivel([aresta("I-2", "I-1")], livre("I-2"), "I-1");
  });
});

test("CA-8: recusa remover de demanda enviada e aresta inexistente", () => {
  assert.throws(() => {
    exigirRemovivel([aresta("I-2", "I-1")], { id: "I-2", enviada: true }, "I-1");
  }, /já foi enviada/);
  assert.throws(() => {
    exigirRemovivel([], livre("I-2"), "I-1");
  }, /não depende/);
});

test("CA-9 e CA-10: concluída e arquivada satisfazem; o resto fica pendente", () => {
  const pendentes = predecessorasPendentes([
    { demanda_id: "I-1", fase: "execucao" },
    { demanda_id: "I-5", fase: "arquivada" },
    { demanda_id: "I-6", fase: "concluida" },
    { demanda_id: "I-7", fase: "cancelada" },
  ]);
  assert.deepEqual(pendentes, ["I-1", "I-7"]);
});

test("CA-11: dependentes diretas e indiretas não concluídas, sem repetir", () => {
  const arestas = [
    aresta("I-2", "I-1"),
    aresta("I-3", "I-2"),
    aresta("I-4", "I-1"),
    aresta("I-3", "I-1"),
    aresta("I-8", "I-2"),
  ];
  const fases = new Map([
    ["I-2", "execucao"],
    ["I-3", "registro"],
    ["I-4", "concluida"],
  ] as const);
  assert.deepEqual(dependentesNaoConcluidas(arestas, fases, "I-1").toSorted(), ["I-2", "I-3"]);
});

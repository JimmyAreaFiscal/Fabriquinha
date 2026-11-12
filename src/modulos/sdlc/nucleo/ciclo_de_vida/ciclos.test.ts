// Os ciclos da demanda e da rodada congelados: os nomes dos estados vão ao banco e ao contrato, então os ciclos derivados
// do catálogo de Etapas têm de dar exatamente estes estados, transições, terminais e o mapa de estado para Etapa.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CicloDeVida } from "./ciclo_de_vida.ts";
import {
  CICLO_DA_DEMANDA,
  CICLO_DA_RODADA,
  etapaDoEstado,
  etapaSeguinte,
  gateQueEsperaGenteNaRodada,
  PRIMEIRA_ETAPA_DA_DEMANDA,
  PRIMEIRA_ETAPA_DA_RODADA,
  EstadoDemanda,
  EstadoRodada,
} from "./ciclos.ts";

// `satisfies Record<Estado…>`: o tipo derivado do catálogo tem exatamente estes estados, nem um a mais nem um a menos.
const TRANSICOES_DA_DEMANDA = {
  entender_e_desenhar: ["gate_demanda", "cancelada"],
  gate_demanda: ["planejar", "cancelada"],
  planejar: ["gate_planejamento", "cancelada"],
  gate_planejamento: ["planejar", "em_execucao", "cancelada"],
  em_execucao: ["revisar_demanda", "cancelada"],
  revisar_demanda: ["em_execucao", "encerrar_demanda", "cancelada"],
  encerrar_demanda: ["concluida", "cancelada"],
  concluida: ["arquivada"],
  arquivada: [],
  cancelada: [],
} satisfies Record<EstadoDemanda, readonly EstadoDemanda[]>;

const TRANSICOES_DA_RODADA = {
  implementar: ["revisar_rodada"],
  revisar_rodada: ["encerrar_rodada", "implementar"],
  encerrar_rodada: ["gate_pr", "implementar"],
  gate_pr: ["ajustar_resultado", "concluida"],
  ajustar_resultado: ["implementar"],
  concluida: [],
} satisfies Record<EstadoRodada, readonly EstadoRodada[]>;

const ETAPA_DO_ESTADO = {
  entender_e_desenhar: "entender_e_desenhar",
  gate_demanda: "entender_e_desenhar",
  planejar: "planejar",
  gate_planejamento: "planejar",
  em_execucao: undefined,
  revisar_demanda: "revisar_demanda",
  encerrar_demanda: "encerrar_demanda",
  concluida: undefined,
  arquivada: undefined,
  cancelada: undefined,
  implementar: "implementar",
  revisar_rodada: "revisar_rodada",
  encerrar_rodada: "encerrar_rodada",
  gate_pr: "encerrar_rodada",
  ajustar_resultado: "ajustar_resultado",
};

// A ordem dos destinos só aparece na mensagem de recusa; o que o ciclo permite é o conjunto.
const comDestinosOrdenados = (transicoes: Readonly<Record<string, readonly string[]>>) =>
  Object.fromEntries(Object.entries(transicoes).map(([estado, destinos]) => [estado, [...destinos].sort()]));

const classificacao = <Estado extends string>(ciclo: CicloDeVida<Estado>, estados: readonly Estado[]) => ({
  terminais: estados.filter((estado) => ciclo.ehTerminal(estado)),
  satisfazemDependencia: estados.filter((estado) => ciclo.satisfazDependencia(estado)),
  emAndamento: estados.filter((estado) => ciclo.estaEmAndamento(estado)),
});

test("o ciclo da demanda tem os estados, as transições e a classificação de sempre", () => {
  assert.deepEqual(EstadoDemanda.options, Object.keys(TRANSICOES_DA_DEMANDA));
  assert.deepEqual(Object.keys(CICLO_DA_DEMANDA.transicoes), EstadoDemanda.options);
  assert.deepEqual(comDestinosOrdenados(CICLO_DA_DEMANDA.transicoes), comDestinosOrdenados(TRANSICOES_DA_DEMANDA));
  assert.deepEqual(classificacao(CICLO_DA_DEMANDA, EstadoDemanda.options), {
    terminais: ["concluida", "arquivada", "cancelada"],
    satisfazemDependencia: ["concluida", "arquivada"],
    emAndamento: [
      "entender_e_desenhar",
      "gate_demanda",
      "planejar",
      "gate_planejamento",
      "em_execucao",
      "revisar_demanda",
      "encerrar_demanda",
    ],
  });
});

test("o ciclo da rodada tem os estados, as transições e a classificação de sempre", () => {
  assert.deepEqual(EstadoRodada.options, Object.keys(TRANSICOES_DA_RODADA));
  assert.deepEqual(Object.keys(CICLO_DA_RODADA.transicoes), EstadoRodada.options);
  assert.deepEqual(comDestinosOrdenados(CICLO_DA_RODADA.transicoes), comDestinosOrdenados(TRANSICOES_DA_RODADA));
  assert.deepEqual(classificacao(CICLO_DA_RODADA, EstadoRodada.options), {
    terminais: ["concluida"],
    satisfazemDependencia: ["concluida"],
    emAndamento: ["implementar", "revisar_rodada", "encerrar_rodada", "gate_pr", "ajustar_resultado"],
  });
});

test("cada estado da demanda e da rodada tem a Etapa de sempre", () => {
  const estados = [...new Set([...EstadoDemanda.options, ...EstadoRodada.options])];
  assert.deepEqual(Object.fromEntries(estados.map((estado) => [estado, etapaDoEstado(estado)])), ETAPA_DO_ESTADO);
});

test("a primeira Etapa de cada escopo e a seguinte de cada estado vêm da ordem do SDLC", () => {
  assert.equal(PRIMEIRA_ETAPA_DA_DEMANDA, "entender_e_desenhar");
  assert.equal(PRIMEIRA_ETAPA_DA_RODADA, "implementar");
  assert.equal(etapaSeguinte("entender_e_desenhar"), "planejar");
  assert.equal(etapaSeguinte("em_execucao"), "revisar_demanda");
  assert.equal(etapaSeguinte("implementar"), "revisar_rodada");
  // Depois de planejar vem a execução das rodadas, que não é Etapa; a última Etapa e o estado de Gate não têm seguinte.
  for (const estado of ["planejar", "encerrar_rodada", "gate_pr"] as const) {
    assert.throws(() => etapaSeguinte(estado), new RegExp(`nenhuma etapa segue o estado ${estado}`));
  }
});

test("o Gate do PR espera gente no estado de espera dele e na sessão de ajustes; nenhum outro estado da rodada espera", () => {
  assert.deepEqual(
    Object.fromEntries(EstadoRodada.options.map((estado) => [estado, gateQueEsperaGenteNaRodada(estado)])),
    {
      implementar: undefined,
      revisar_rodada: undefined,
      encerrar_rodada: undefined,
      gate_pr: "gate_pr",
      ajustar_resultado: "gate_pr",
      concluida: undefined,
    },
  );
  // Só os Gates da rodada: o planejamento, aonde o Gate do planejamento volta ao reprovar, não espera gente aqui.
  assert.equal(gateQueEsperaGenteNaRodada("planejar"), undefined);
});

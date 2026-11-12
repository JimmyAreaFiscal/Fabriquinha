// As Etapas que a API serve, como as telas as leem: os rótulos, os estados, as colunas do andamento e as fases.
import assert from "node:assert/strict";
import { test } from "node:test";
import { descreverEtapasDoSdlc } from "../../api/rotas/etapas.ts";
import { EstadoDemanda, EstadoRodada } from "../../../modulos/sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import {
  aparenciaDoEstado,
  colunasDoAndamento,
  definirEtapasDoSdlc,
  estadosDaDemandaEmAndamento,
  etapaDoPapel,
  etapaDoSdlc,
  etapasNaOrdemDoFluxo,
  fasesSobreAsColunas,
  rotuloDaEtapa,
  rotuloDoGate,
  tituloPadraoDaEtapa,
} from "./etapas.ts";

test("antes de a API servir as Etapas, ler uma delas é defeito do cliente", () => {
  assert.throws(() => rotuloDaEtapa("planejar"), /ainda não vieram da API/);
});

test("com as Etapas da API: o rótulo, o título padrão, a fase, o papel e o Gate de cada uma", () => {
  definirEtapasDoSdlc(descreverEtapasDoSdlc());
  assert.equal(rotuloDaEtapa("entender_e_desenhar"), "Demanda");
  assert.equal(tituloPadraoDaEtapa("resolver_conflito"), "Resolver o conflito");
  assert.equal(etapaDoPapel("ajusta_o_pr_reprovado"), "ajustar_resultado");
  assert.equal(rotuloDoGate("gate_revisao_rodada"), "revisão da rodada");
  definirEtapasDoSdlc({ ...descreverEtapasDoSdlc(), etapas: [] });
  assert.throws(() => etapaDoSdlc("planejar"), /a Etapa planejar não veio da API/);
  assert.throws(() => etapaDoPapel("planeja_a_demanda"), /nenhuma Etapa da API tem o papel planeja_a_demanda/);
  assert.throws(() => rotuloDoGate("gate_pr"), /nenhuma Etapa da API tem o Gate gate_pr/);
});

test("todo estado da demanda e da rodada tem rótulo e cor de pílula: o da Etapa, o do Gate e o do motor", () => {
  definirEtapasDoSdlc(descreverEtapasDoSdlc());
  assert.deepEqual(
    EstadoDemanda.options.map((estado) => aparenciaDoEstado(estado)),
    [
      ["Registro", "pill-neutro"],
      ["Aprovação da demanda", "pill-aguarda"],
      ["Planejamento", "pill-rodando"],
      ["Aprovação do planejamento", "pill-aguarda"],
      ["Execução", "pill-rodando"],
      ["Revisão da demanda", "pill-rodando"],
      ["Encerramento", "pill-rodando"],
      ["Concluída", "pill-ok"],
      ["Arquivada", "pill-neutro"],
      ["Cancelada", "pill-cancelada"],
    ],
  );
  assert.deepEqual(
    EstadoRodada.options.map((estado) => aparenciaDoEstado(estado)),
    [
      ["Desenvolvimento", "pill-rodando"],
      ["Revisão", "pill-rodando"],
      ["Encerramento", "pill-rodando"],
      ["Aprovação do PR", "pill-aguarda"],
      ["Sessão de ajustes", "pill-aguarda"],
      ["Concluída", "pill-ok"],
    ],
  );
  assert.throws(() => aparenciaDoEstado("desconhecido" as EstadoDemanda), /não é de Etapa, de Gate nem do motor/);
});

test("as colunas do andamento: os estados da demanda e, no lugar da execução, os da rodada, com os rótulos das telas", () => {
  definirEtapasDoSdlc(descreverEtapasDoSdlc());
  assert.deepEqual(
    colunasDoAndamento().map(({ estado, de, gate, noInicio, noProjeto }) => [estado, de, gate, noInicio, noProjeto]),
    [
      ["entender_e_desenhar", "demanda", false, "Registro", "Registro"],
      ["gate_demanda", "demanda", true, "Aprovação da demanda", "Aprovação da demanda"],
      ["planejar", "demanda", false, "Planejamento", "Planejamento"],
      ["gate_planejamento", "demanda", true, "Aprovação do planejamento", "Aprovação do planejamento"],
      ["implementar", "rodada", false, "Desenvolvimento", "Desenvol­vimento"],
      ["revisar_rodada", "rodada", false, "Revisão da rodada", "Revisão"],
      ["encerrar_rodada", "rodada", false, "Encerramento da rodada", "Encerramento"],
      ["gate_pr", "rodada", true, "Aprovação do PR", "Aprovação do PR"],
      ["ajustar_resultado", "rodada", false, "Ajustes do PR", "Ajustes do PR"],
      ["revisar_demanda", "demanda", false, "Revisão da demanda", "Revisão da demanda"],
      ["encerrar_demanda", "demanda", false, "Encerramento da demanda", "Encerramento da demanda"],
    ],
  );
  assert.deepEqual(estadosDaDemandaEmAndamento(), [
    "entender_e_desenhar",
    "gate_demanda",
    "planejar",
    "gate_planejamento",
    "em_execucao",
    "revisar_demanda",
    "encerrar_demanda",
  ]);
  const abreNasEtapasDaDemanda = (estado: string) =>
    ["entender_e_desenhar", "planejar", "revisar_demanda"].includes(estado);
  assert.deepEqual(fasesSobreAsColunas(colunasDoAndamento(), abreNasEtapasDaDemanda), [
    { rotulo: "Registrar", colunas: 2 },
    { rotulo: "Planejar", colunas: 7 },
    { rotulo: "Revisar", colunas: 2 },
  ]);
});

test("as Etapas na ordem do fluxo: a do SDLC, com as da rodada na execução, e depois as de fora dela", () => {
  definirEtapasDoSdlc(descreverEtapasDoSdlc());
  assert.deepEqual(etapasNaOrdemDoFluxo(), [
    "entender_e_desenhar",
    "planejar",
    "implementar",
    "revisar_rodada",
    "encerrar_rodada",
    "revisar_demanda",
    "encerrar_demanda",
    "resolver_conflito",
    "ajustar_resultado",
  ]);
});

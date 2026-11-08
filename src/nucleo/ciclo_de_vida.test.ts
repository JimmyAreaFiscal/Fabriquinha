import assert from "node:assert/strict";
import { test } from "node:test";
import { CicloDeVida } from "./ciclo_de_vida.ts";
import { CICLO_DA_DEMANDA, CICLO_DA_RODADA, CICLO_DO_TICKET, etapaDoEstado } from "./ciclos.ts";
import { ErroDeRegra } from "./erros.ts";
import { EstadoDemanda, EstadoRodada, EstadoTicket } from "./primitivos.ts";

const agora = "2026-01-02T00:00:00Z";
const ciclo = new CicloDeVida<"a" | "b" | "c">({
  transicoes: { a: ["b"], b: ["a", "c"], c: [] },
  terminais: ["c"],
  satisfazemDependencia: ["c"],
  emAndamento: ["a", "b"],
});
const item = (estado: "a" | "b" | "c") => ({ estado, estado_alterado_em: "2026-01-01T00:00:00Z", outro: 1 });

test("mudar: transição declarada grava o destino e o instante e preserva o resto, sem mutar o original", () => {
  const original = item("a");
  const mudado = ciclo.mudar(original, "b", agora);
  assert.deepEqual(mudado, { estado: "b", estado_alterado_em: agora, outro: 1 });
  assert.equal(original.estado, "a");
});

test("mudar: transição não declarada é rejeitada, e o terminal diz que é terminal", () => {
  assert.throws(() => ciclo.mudar(item("a"), "c", agora), /não há transição de a para c \(de a só se vai a b\)/);
  assert.throws(() => ciclo.mudar(item("c"), "a", agora), /c é terminal/);
  assert.throws(() => ciclo.mudar(item("a"), "a", agora), ErroDeRegra);
});

test("exigir: aceita um dos permitidos e recusa os demais citando o estado atual e os permitidos", () => {
  ciclo.exigir(item("a"), "a");
  ciclo.exigir(item("b"), "a", "b");
  assert.throws(() => {
    ciclo.exigir(item("b"), "a");
  }, /o estado atual é b \(só no estado a\)/);
  assert.throws(() => {
    ciclo.exigir(item("c"), "a", "b");
  }, /o estado atual é c \(só nos estados a, b\)/);
});

test("terminais, dependência e andamento vêm da definição", () => {
  assert.deepEqual(
    ["a", "b", "c"].map((e) => ciclo.ehTerminal(e as "a")),
    [false, false, true],
  );
  assert.deepEqual(
    ["a", "b", "c"].map((e) => ciclo.satisfazDependencia(e as "a")),
    [false, false, true],
  );
  assert.deepEqual(
    ["a", "b", "c"].map((e) => ciclo.estaEmAndamento(e as "a")),
    [true, true, false],
  );
});

test("sqlDosTerminais: o predicado IN da coluna, só com os terminais", () => {
  assert.equal(ciclo.sqlDosTerminais("estado"), "estado IN ('c')");
  const comDoisTerminais = new CicloDeVida<"a" | "b" | "c">({
    transicoes: { a: ["b", "c"], b: [], c: [] },
    terminais: ["b", "c"],
    satisfazemDependencia: [],
    emAndamento: ["a"],
  });
  assert.equal(comDoisTerminais.sqlDosTerminais("x.estado"), "x.estado IN ('b', 'c')");
});

test("os ciclos declaram todos os estados, com destinos e terminais válidos e terminais sem saída", () => {
  const ciclos = [
    [CICLO_DA_DEMANDA, EstadoDemanda.options],
    [CICLO_DA_RODADA, EstadoRodada.options],
    [CICLO_DO_TICKET, EstadoTicket.options],
  ] as const;
  for (const [cicloDoItem, estados] of ciclos) {
    const declarados: readonly string[] = Object.keys(cicloDoItem.transicoes);
    assert.deepEqual([...declarados].sort(), [...estados].sort());
    for (const destinos of Object.values<readonly string[]>(cicloDoItem.transicoes)) {
      for (const destino of destinos) assert.ok(declarados.includes(destino), destino);
    }
    assert.ok(estados.some((e) => cicloDoItem.ehTerminal(e as never)));
  }
});

test("satisfazem dependência: concluída e arquivada na demanda, concluída na rodada, concluído no ticket", () => {
  assert.deepEqual(
    EstadoDemanda.options.filter((e) => CICLO_DA_DEMANDA.satisfazDependencia(e)),
    ["concluida", "arquivada"],
  );
  assert.deepEqual(
    EstadoRodada.options.filter((e) => CICLO_DA_RODADA.satisfazDependencia(e)),
    ["concluida"],
  );
  assert.deepEqual(
    EstadoTicket.options.filter((e) => CICLO_DO_TICKET.satisfazDependencia(e)),
    ["concluido"],
  );
});

test("em andamento: demanda e rodada enquanto não terminam; ticket aberto ou em execução", () => {
  assert.deepEqual(
    EstadoDemanda.options.filter((e) => CICLO_DA_DEMANDA.estaEmAndamento(e)),
    EstadoDemanda.options.filter((e) => !CICLO_DA_DEMANDA.ehTerminal(e)),
  );
  assert.deepEqual(
    EstadoRodada.options.filter((e) => CICLO_DA_RODADA.estaEmAndamento(e)),
    EstadoRodada.options.filter((e) => !CICLO_DA_RODADA.ehTerminal(e)),
  );
  assert.deepEqual(
    EstadoTicket.options.filter((e) => CICLO_DO_TICKET.estaEmAndamento(e)),
    ["aberto", "em_execucao"],
  );
});

test("etapaDoEstado: o próprio nome, a etapa do ticket que o gate espera, ou nenhuma", () => {
  assert.deepEqual(
    [...EstadoDemanda.options, ...EstadoRodada.options].map((e) => [e, etapaDoEstado(e)]),
    [
      ["entender_e_desenhar", "entender_e_desenhar"],
      ["gate_demanda", "entender_e_desenhar"],
      ["planejar", "planejar"],
      ["gate_planejamento", "planejar"],
      ["em_execucao", undefined],
      ["revisar_demanda", "revisar_demanda"],
      ["encerrar_demanda", "encerrar_demanda"],
      ["concluida", undefined],
      ["arquivada", undefined],
      ["cancelada", undefined],
      ["implementar", "implementar"],
      ["revisar_rodada", "revisar_rodada"],
      ["encerrar_rodada", "encerrar_rodada"],
      ["gate_pr", "encerrar_rodada"],
      ["ajustar_resultado", "ajustar_resultado"],
      ["concluida", undefined],
    ],
  );
});

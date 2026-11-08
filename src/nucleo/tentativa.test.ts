import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR } from "./ator.ts";
import { Endereco } from "./item_de_trabalho.ts";
import { montarRetornoAoAgente, type Tentativa, tentativaAnteriorEmMemoria } from "./tentativa.ts";

const ticket = Endereco.doTicket("I-1", 3);

test("a Tentativa reprovada devolve o ticket com o motivo dela, ignorando a instrução do Auditor", () => {
  const anterior = tentativaAnteriorEmMemoria(ticket, { motivoDaReprovacao: "o teste falhou" });
  assert.deepEqual(montarRetornoAoAgente(anterior, "outra coisa"), {
    titulo: "Devolução",
    texto:
      "O ticket I-1.T3 foi devolvido a você: a entrega anterior não passou. " +
      "Corrija o que o motivo aponta e não refaça o resto.\n\nMotivo: o teste falhou",
  });
});

test("a Tentativa interrompida reabre o ticket com a instrução do Auditor, ou com a que ela guarda", () => {
  const anterior = tentativaAnteriorEmMemoria(ticket, { instrucao: "guardada" });
  assert.deepEqual(anterior.resultado, { tipo: "interrompida", por: AUDITOR });
  const reabertura = (motivo: string) => ({
    titulo: "Reabertura",
    texto: `O Auditor reabriu o ticket I-1.T3. Continue de onde a entrega anterior parou e atenda ao motivo.\n\nMotivo: ${motivo}`,
  });
  assert.deepEqual(montarRetornoAoAgente(anterior, "do Auditor"), reabertura("do Auditor"));
  assert.deepEqual(montarRetornoAoAgente(anterior), reabertura("guardada"));
});

test("a Tentativa sem resultado e sem instrução não tem como reabrir", () => {
  const semInstrucao: Tentativa = { ticket, numero: 2, inicio: "2026-01-01T00:00:00.000Z" };
  assert.throws(() => montarRetornoAoAgente(semInstrucao), /a Tentativa 2 de I-1\.T3 não tem instrução para reabrir/);
});

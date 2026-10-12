import assert from "node:assert/strict";
import { test } from "node:test";
import { encontrado, ErroDeEscopo, ErroDeInexistente, ErroDeRegra } from "./erros.ts";

test("ErroDeRegra diz numa frase o que faltou e como resolver", () => {
  const erro = new ErroDeRegra(
    "T-34 não pode concluir: falta a evidência relatorio_complexidade",
    "submeta com fabriquinha evidencia add relatorio_complexidade",
  );
  assert.ok(erro instanceof Error);
  assert.equal(erro.name, "ErroDeRegra");
  assert.equal(
    erro.message,
    "T-34 não pode concluir: falta a evidência relatorio_complexidade (submeta com fabriquinha evidencia add relatorio_complexidade)",
  );
});

test("ErroDeEscopo é distinguível do ErroDeRegra", () => {
  const erro = new ErroDeEscopo("a execução E-7 já terminou", "peça ao Auditor uma nova execução");
  assert.ok(erro instanceof Error);
  assert.ok(!(erro instanceof ErroDeRegra));
  assert.equal(erro.name, "ErroDeEscopo");
  assert.equal(erro.message, "a execução E-7 já terminou (peça ao Auditor uma nova execução)");
});

test("ErroDeInexistente é um ErroDeRegra que o web distingue (404)", () => {
  assert.equal(encontrado(0, "a issue I-9 não existe", "confira o número"), 0);
  assert.throws(
    () => {
      encontrado(undefined, "a issue I-9 não existe", "confira o número");
    },
    (erro) =>
      erro instanceof ErroDeInexistente &&
      erro instanceof ErroDeRegra &&
      erro.name === "ErroDeInexistente" &&
      erro.message === "a issue I-9 não existe (confira o número)",
  );
});

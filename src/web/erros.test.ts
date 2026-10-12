import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ErroDeEscopo, ErroDeInexistente, ErroDeRegra, ErroExterno } from "../dominio/erros.ts";
import { ErroHttp, traduzir } from "./erros.ts";

test("mapa de erros do F7 §4.2", () => {
  assert.deepEqual(traduzir(new ErroDeEscopo("não é seu", "peça ao Auditor")), [403, "não é seu (peça ao Auditor)"]);
  assert.deepEqual(traduzir(new ErroDeInexistente("a issue I-9 não existe", "confira")), [
    404,
    "a issue I-9 não existe (confira)",
  ]);
  assert.deepEqual(traduzir(new ErroDeRegra("já há execução autônoma em andamento: E-3", "espere")), [
    409,
    "já há execução autônoma em andamento: E-3 (espere)",
  ]);
  assert.deepEqual(traduzir(new ErroExterno("gh pr view saiu com código 1: HTTP 401", "confira")), [
    502,
    "gh pr view saiu com código 1: HTTP 401 (confira)",
  ]);
  assert.deepEqual(traduzir(new ErroHttp(502, "gh: remoto inválido")), [502, "gh: remoto inválido"]);
  assert.deepEqual(traduzir(new Error("disco cheio")), [500, "disco cheio"]);
});

test("erro de schema dá 422 com o caminho de cada campo", () => {
  const { error } = z.object({ fitness: z.array(z.object({ nome: z.string() })) }).safeParse({ fitness: [{}] });
  const [status, texto] = traduzir(error);
  assert.equal(status, 422);
  assert.match(texto, /→ at fitness\[0\]\.nome/);
});

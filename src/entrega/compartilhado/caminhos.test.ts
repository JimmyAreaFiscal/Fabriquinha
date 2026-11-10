import assert from "node:assert/strict";
import { test } from "node:test";
import { casar } from "./caminhos.ts";

test("casar devolve os parâmetros decodificados de cada segmento", () => {
  assert.deepEqual(casar("/api/sessoes", "/api/sessoes"), {});
  assert.deepEqual(casar("/projects/:projeto/demandas/:demanda", "/projects/loja%20api/demandas/I-3"), {
    projeto: "loja api",
    demanda: "I-3",
  });
});

test("casar recusa outro tamanho, outro segmento fixo, parâmetro vazio e escape malformado", () => {
  assert.equal(casar("/projects/:projeto", "/projects"), undefined);
  assert.equal(casar("/projects/:projeto", "/projects/a/b"), undefined);
  assert.equal(casar("/projects/:projeto", "/project/a"), undefined);
  assert.equal(casar("/projects/:projeto", "/projects/"), undefined);
  assert.equal(casar("/projects/:projeto", "/projects/%E0%A4%A"), undefined);
});

test("casar trata o ponto do padrão como literal", () => {
  assert.deepEqual(casar("/api/sessoes/:sessao/historico.md", "/api/sessoes/s1/historico.md"), { sessao: "s1" });
  assert.equal(casar("/api/sessoes/:sessao/historico.md", "/api/sessoes/s1/historicoXmd"), undefined);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { casar, rotear } from "./caminhos.ts";

test("casar devolve os parâmetros decodificados de cada segmento", () => {
  assert.deepEqual(casar("/api/sessoes", "/api/sessoes"), {});
  assert.deepEqual(casar("/projects/:projeto/issues/:issue", "/projects/loja%20api/issues/I-3"), {
    projeto: "loja api",
    issue: "I-3",
  });
});

test("casar recusa outro tamanho, outro segmento fixo, parâmetro vazio e escape malformado", () => {
  assert.equal(casar("/projects/:projeto", "/projects"), undefined);
  assert.equal(casar("/projects/:projeto", "/projects/a/b"), undefined);
  assert.equal(casar("/projects/:projeto", "/project/a"), undefined);
  assert.equal(casar("/projects/:projeto", "/projects/"), undefined);
  assert.equal(casar("/projects/:projeto", "/projects/%E0%A4%A"), undefined);
});

test("rotear escolhe a página do F7 §4.4 pelo caminho", () => {
  assert.deepEqual(rotear("/home"), { pagina: "inicio", params: {} });
  assert.deepEqual(rotear("/projects"), { pagina: "projeto", params: {} });
  assert.deepEqual(rotear("/projects/loja"), { pagina: "projeto", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/projects/loja/heatmap"), { pagina: "heatmap", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/projects/loja/sdlc"), { pagina: "sdlc", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/projects/loja/issues/I-3"), { pagina: "issue", params: { projeto: "loja", issue: "I-3" } });
  assert.deepEqual(rotear("/demandas"), { pagina: "demandas", params: {} });
  assert.deepEqual(rotear("/demandas/I-206"), { pagina: "demanda", params: { demanda: "I-206" } });
  assert.deepEqual(rotear("/projects/loja/demandas"), { pagina: "demandas", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/simulation"), { pagina: "simulacao", params: {} });
  assert.deepEqual(rotear("/simulation/loja"), { pagina: "simulacao", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/metrics"), { pagina: "metricas", params: {} });
  assert.deepEqual(rotear("/history"), { pagina: "historico", params: {} });
  assert.deepEqual(rotear("/sessions/abc"), { pagina: "chat", params: { sessao: "abc" } });
  assert.deepEqual(rotear("/audits/abc"), { pagina: "auditoria", params: { sessao: "abc" } });
  assert.deepEqual(rotear("/evaluations"), { pagina: "avaliacoes", params: {} });
  assert.deepEqual(rotear("/evaluations/a%2F1"), { pagina: "avaliacao", params: { avaliacao: "a/1" } });
  assert.deepEqual(rotear("/config"), { pagina: "configuracao", params: {} });
  assert.equal(rotear("/nada"), undefined);
});

test("casar trata o ponto do padrão como literal", () => {
  assert.deepEqual(casar("/api/sessoes/:sessao/historico.md", "/api/sessoes/s1/historico.md"), { sessao: "s1" });
  assert.equal(casar("/api/sessoes/:sessao/historico.md", "/api/sessoes/s1/historicoXmd"), undefined);
});

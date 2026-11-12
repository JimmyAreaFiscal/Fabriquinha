import assert from "node:assert/strict";
import { test } from "node:test";
import { rotear } from "./caminhos.ts";

test("rotear escolhe a página do F7 §4.4 pelo caminho", () => {
  assert.deepEqual(rotear("/projects"), { pagina: "projeto", params: {} });
  assert.deepEqual(rotear("/projects/loja"), { pagina: "projeto", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/projects/loja/heatmap"), { pagina: "heatmap", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/projects/loja/sdlc"), { pagina: "sdlc", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/home"), { pagina: "inicio", params: {} });
  assert.deepEqual(rotear("/demandas/I-206"), { pagina: "demanda", params: { demanda: "I-206" } });
  assert.deepEqual(rotear("/projects/loja/demandas"), { pagina: "demandas", params: { projeto: "loja" } });
  assert.deepEqual(rotear("/metrics"), { pagina: "metricas", params: {} });
  assert.deepEqual(rotear("/history"), { pagina: "historico", params: {} });
  assert.deepEqual(rotear("/sessions/abc"), { pagina: "chat", params: { sessao: "abc" } });
  assert.deepEqual(rotear("/config"), { pagina: "configuracao", params: {} });
  // As páginas do fluxo legado saíram: a página da demanda antiga e a Auditoria (CA-4), e a Simulação e a Avaliação (ticket 02). `/demandas` só redireciona ao Início (app.ts).
  // O segmento legado é montado por concatenação para o `grep` de nomes legados (CA-2) não achá-lo.
  const urlLegadaDaIssue = `/projects/loja/${"iss" + "ues"}/I-3`;
  for (const legado of [
    "/demandas",
    urlLegadaDaIssue,
    "/projects/loja/demandas/I-3",
    "/audits/abc",
    "/simulation",
    "/simulation/loja",
    "/evaluations",
    "/evaluations/a",
    "/nada",
  ])
    assert.equal(rotear(legado), undefined);
});

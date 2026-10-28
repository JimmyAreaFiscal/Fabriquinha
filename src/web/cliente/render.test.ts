import assert from "node:assert/strict";
import { test } from "node:test";
import {
  caminhoDaAvaliacao,
  caminhoDaDemanda,
  caminhoDaSessao,
  compacto,
  custo,
  duracao,
  escapar,
  FASE_DA_DEMANDA,
  FASE_DA_RODADA,
  modeloDoSeletor,
  NAO_ENCONTRADA,
  navegacao,
  nomeDoModelo,
  plural,
  rotuloDoStatus,
  TITULOS,
} from "./render.ts";

test("formatos: duração, custo e compacto", () => {
  assert.deepEqual([0, 48_400, 60_000, 130_000, 3_600_000, 4_800_000].map(duracao), [
    "0 s",
    "48 s",
    "1 min",
    "2 min 10 s",
    "1 h",
    "1 h 20 min",
  ]);
  assert.equal(custo(0.5), "US$ 0,50");
  assert.deepEqual([compacto(2_300_000), compacto(48_120), compacto(950)], ["2,3 M", "48,1 mil", "950"]);
  assert.deepEqual([compacto(1_234_500_000), compacto(830.4)], ["1.234,5 M", "830"]);
  assert.deepEqual([plural(1, "falha", "falhas"), plural(0, "falha", "falhas")], ["1 falha", "0 falhas"]);
  assert.equal(
    plural(1.5, "mês", "meses", (n) => n.toFixed(1)),
    "1.5 meses",
  );
});

test("caminhos e rótulos: o chat e o modelo", () => {
  assert.equal(caminhoDaSessao("a/b c"), "/sessions/a%2Fb%20c");
  assert.equal(nomeDoModelo({ provedor: "anthropic", modelo: "claude" }), "anthropic / claude");
  assert.deepEqual(modeloDoSeletor("openrouter/anthropic/claude"), {
    provedor: "openrouter",
    modelo: "anthropic/claude",
  });
  assert.deepEqual([modeloDoSeletor(""), modeloDoSeletor("/sem-provedor")], [null, null]);
});

test("escapar neutraliza HTML vindo do agente", () => {
  assert.equal(
    escapar(`<img src=x onerror="alert('x')">&`),
    "&#60;img src=x onerror=&#34;alert(&#39;x&#39;)&#34;&#62;&#38;",
  );
  assert.equal(escapar(3), "3");
});

test("navegação fixa marca a página atual e mostra quem aguarda só quando há", () => {
  const html = navegacao("projeto", 6);
  assert.match(html, /<a href="\/projects" aria-current="page">Projetos<\/a>/);
  assert.match(
    html,
    /<a href="\/demandas">Demandas <span class="contador" title="sessões que aguardam você">6<\/span><\/a>/,
  );
  assert.deepEqual(
    [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]),
    ["/projects", "/demandas", "/simulation", "/metrics", "/history", "/evaluations", "/config"],
  );
  assert.doesNotMatch(html, /Início|Auditoria/);
  assert.match(navegacao("simulacao", 0), /<a href="\/simulation" aria-current="page">Simulação<\/a>/);
  assert.match(navegacao("demandas", 0), /<a href="\/demandas" aria-current="page">Demandas<\/a>/);
  assert.match(navegacao("avaliacoes", 0), /<a href="\/evaluations" aria-current="page">Avaliações<\/a>/);
  assert.match(navegacao("avaliacao", 0), /<a href="\/evaluations" aria-current="page">Avaliações<\/a>/);
  assert.equal(TITULOS.avaliacoes, "Avaliações");
  assert.equal(caminhoDaAvaliacao("a/b c"), "/evaluations/a%2Fb%20c");
  assert.equal(TITULOS.demandas, "Demandas");
  assert.match(navegacao("demanda", 0), /<a href="\/demandas" aria-current="page">Demandas<\/a>/);
  assert.equal(TITULOS.demanda, "Demanda");
  assert.equal(caminhoDaDemanda("I-206"), "/demandas/I-206");
  assert.equal(rotuloDoStatus("em_execucao"), "Em execução");
  assert.match(navegacao("sdlc", 0), /<a href="\/projects" aria-current="page">Projetos<\/a>/);
  assert.equal(TITULOS.sdlc, "Configuração SDLC");
  assert.match(navegacao("heatmap", 0), /<a href="\/projects" aria-current="page">Projetos<\/a>/);
  assert.doesNotMatch(navegacao("demandas", 0), /contador/);
  assert.doesNotMatch(navegacao(undefined, 0), /aria-current/);
  assert.doesNotMatch(navegacao("chat", 0), /aria-current/);
  assert.match(navegacao("historico", 0), /<a href="\/history" aria-current="page">Histórico<\/a>/);
});

test("a página não encontrada leva às Demandas", () => {
  assert.match(NAO_ENCONTRADA, /href="\/demandas">Ir para as Demandas</);
});

test("toda fase da demanda e da rodada tem rótulo e cor de pílula", () => {
  for (const [rotulo, pilula] of [...Object.values(FASE_DA_DEMANDA), ...Object.values(FASE_DA_RODADA)]) {
    assert.match(rotulo, /^\p{Lu}/u);
    assert.match(pilula, /^pill-/);
  }
  assert.equal(FASE_DA_DEMANDA.aprovacao_demanda[0], "Aprovação da demanda");
  assert.equal(FASE_DA_RODADA.aprovacao_pull_request[0], "Aprovação do PR");
});

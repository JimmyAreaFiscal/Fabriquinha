import assert from "node:assert/strict";
import { test } from "node:test";
import type { InfoSessao } from "../../execucao/sessoes.ts";
import {
  caminhoDaIssue,
  caminhoDaSessao,
  compacto,
  custo,
  data,
  duracao,
  escapar,
  FASE_DA_DEMANDA,
  FASE_DA_RODADA,
  estadoDoTrilho,
  FASES,
  etapa,
  modeloDoSeletor,
  NAO_ENCONTRADA,
  navegacao,
  caminhoDaAuditoria,
  mesPorExtenso,
  TITULOS,
  NOME_DA_ETAPA,
  nomeDoModelo,
  paginaVazia,
  plural,
  rotuloIssue,
  rotuloTicket,
  trilho,
} from "./render.ts";

// As datas saem no fuso do navegador; o teste fixa um.
process.env.TZ = "America/Sao_Paulo";

test("formatos: data no fuso do navegador, duração, custo e compacto", () => {
  assert.equal(data("2026-10-11T12:05:00.000Z"), "11/10 09:05");
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

test("rótulos e caminhos: I-n, T-n, a issue, o chat, a etapa e o modelo", () => {
  assert.deepEqual([rotuloIssue(7), rotuloTicket(12)], ["I-7", "T-12"]);
  assert.equal(caminhoDaIssue("loja nova", 7), "/projects/loja%20nova/issues/I-7");
  assert.equal(caminhoDaSessao("a/b c"), "/sessions/a%2Fb%20c");
  assert.equal(caminhoDaAuditoria("a/b c"), "/audits/a%2Fb%20c");
  assert.deepEqual([mesPorExtenso("2026-09"), mesPorExtenso("2026-03")], ["setembro de 2026", "março de 2026"]);
  assert.equal(TITULOS.auditoria, "Auditoria");
  assert.deepEqual(
    [NOME_DA_ETAPA.sessao, etapa("sessao"), etapa("revisao")],
    ["Sessão em aberto", "sessão em aberto", "revisão"],
  );
  assert.equal(nomeDoModelo({ provedor: "anthropic", modelo: "claude" }), "anthropic / claude");
  assert.deepEqual(modeloDoSeletor("openrouter/anthropic/claude"), {
    provedor: "openrouter",
    modelo: "anthropic/claude",
  });
  assert.deepEqual([modeloDoSeletor(""), modeloDoSeletor("/sem-provedor")], [null, null]);
});

test("trilho: a falha antes de quem aguarda, e quem aguarda antes do que roda", () => {
  const sessao = (s: Partial<InfoSessao>) => ({ estado: "terminada", ...s }) as InfoSessao;
  const rodando = sessao({ estado: "rodando" });
  const aguarda = sessao({ estado: "aguardando_humano", motivo: "gate_desenho" });
  const falha = sessao({ estado: "aguardando_humano", motivo: "falha" });
  assert.equal(estadoDoTrilho([]), undefined);
  assert.equal(estadoDoTrilho([rodando]), "rodando");
  assert.equal(estadoDoTrilho([rodando, aguarda]), "aguarda");
  assert.equal(estadoDoTrilho([aguarda, falha]), "falha");
});

test("escapar neutraliza HTML vindo do agente", () => {
  assert.equal(
    escapar(`<img src=x onerror="alert('x')">&`),
    "&#60;img src=x onerror=&#34;alert(&#39;x&#39;)&#34;&#62;&#38;",
  );
  assert.equal(escapar(3), "3");
});

test("navegação fixa marca a página atual e mostra quem aguarda só quando há", () => {
  const html = navegacao("issue", 6);
  assert.match(html, /<a href="\/projects" aria-current="page">Projetos<\/a>/);
  assert.match(html, /<a href="\/home">Início <span class="contador" title="sessões que aguardam você">6<\/span><\/a>/);
  assert.deepEqual(
    [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]),
    ["/home", "/projects", "/demandas", "/simulation", "/metrics", "/history", "/config"],
  );
  assert.match(navegacao("simulacao", 0), /<a href="\/simulation" aria-current="page">Simulação<\/a>/);
  assert.match(navegacao("demandas", 0), /<a href="\/demandas" aria-current="page">Demandas<\/a>/);
  assert.equal(TITULOS.demandas, "Demandas");
  assert.match(navegacao("sdlc", 0), /<a href="\/projects" aria-current="page">Projetos<\/a>/);
  assert.equal(TITULOS.sdlc, "Configuração SDLC");
  assert.match(navegacao("heatmap", 0), /<a href="\/projects" aria-current="page">Projetos<\/a>/);
  assert.doesNotMatch(navegacao("inicio", 0), /contador/);
  assert.match(navegacao("inicio", 0), /<a href="\/home" aria-current="page">Início<\/a>/);
  assert.doesNotMatch(navegacao(undefined, 0), /aria-current/);
  assert.doesNotMatch(navegacao("chat", 0), /aria-current/);
  assert.match(navegacao("auditoria", 0), /<a href="\/history" aria-current="page">Histórico<\/a>/);
});

/** As classes de cada passo do trilho, na ordem. */
const passos = (html: string) => [...html.matchAll(/<li class="([^"]+)"/g)].map((m) => m[1]);

/** Todas as fases antes de `fase`, como se a issue tivesse passado por cada uma. */
const ate = (fase: string) =>
  FASES.map(([f]) => f).slice(
    0,
    FASES.findIndex(([f]) => f === fase),
  );

test("trilho: passadas feitas, a atual marcada, gates em losango e a cor do estado", () => {
  const html = trilho("aprovacao_desenho", ate("aprovacao_desenho"), "aguarda");
  assert.match(html, /^<ol class="trilho-fases aguarda" aria-label="Fases da issue">/);
  assert.deepEqual(passos(html), [
    "passo feito",
    "passo feito",
    "passo gate atual",
    "passo",
    "passo",
    "passo",
    "passo gate",
    "passo",
  ]);
  assert.match(html, /<li class="passo gate atual" aria-current="step">.*?<span>Aprovação do desenho<\/span>/);
  assert.match(trilho("registro", []), /^<ol class="trilho-fases" /);
  assert.match(trilho("desenho", ["registro"], "cancelada"), /^<ol class="trilho-fases cancelada" /);
});

test("trilho: a fase antes da atual por que a issue não passou fica neutra, não verde", () => {
  // Uma issue que voltou do PR para o desenvolvimento e está de novo na revisão: o ajuste do PR, depois da atual, não
  // é verde; a aprovação do desenho, se não aconteceu, também não.
  assert.deepEqual(passos(trilho("revisao", ["registro", "desenho", "desenvolvimento", "ajuste_pr"])), [
    "passo feito",
    "passo feito",
    "passo gate",
    "passo feito",
    "passo atual",
    "passo",
    "passo gate",
    "passo",
  ]);
});

test("trilho de issue concluída: as fases percorridas feitas, as que não aconteceram neutras, nenhuma atual", () => {
  const html = trilho("concluida", ate("ajuste_pr"));
  assert.deepEqual(passos(html), [
    "passo feito",
    "passo feito",
    "passo gate feito",
    "passo feito",
    "passo feito",
    "passo feito",
    "passo gate feito",
    "passo",
  ]);
  assert.doesNotMatch(html, /atual|aria-current/);
  assert.ok(passos(trilho("concluida", [...ate("ajuste_pr"), "ajuste_pr"])).every((c) => c?.includes("feito")));
});

test("página vazia escapa o título e a não encontrada leva ao Início", () => {
  assert.equal(paginaVazia("<b>"), '<div class="cabeca-pagina"><h1>&#60;b&#62;</h1></div>');
  assert.match(NAO_ENCONTRADA, /href="\/home"/);
});

test("toda fase da demanda e da rodada tem rótulo e cor de pílula", () => {
  for (const [rotulo, pilula] of [...Object.values(FASE_DA_DEMANDA), ...Object.values(FASE_DA_RODADA)]) {
    assert.match(rotulo, /^\p{Lu}/u);
    assert.match(pilula, /^pill-/);
  }
  assert.equal(FASE_DA_DEMANDA.aprovacao_demanda[0], "Aprovação da demanda");
  assert.equal(FASE_DA_RODADA.aprovacao_pull_request[0], "Aprovação do PR");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { escapar, NAO_ENCONTRADA, navegacao, paginaVazia, trilho } from "./render.ts";

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
    ["/home", "/projects", "/metrics", "/history", "/config"],
  );
  assert.doesNotMatch(navegacao("inicio", 0), /contador/);
  assert.match(navegacao("inicio", 0), /<a href="\/home" aria-current="page">Início<\/a>/);
  assert.doesNotMatch(navegacao(undefined, 0), /aria-current/);
  assert.doesNotMatch(navegacao("chat", 0), /aria-current/);
});

/** As classes de cada passo do trilho, na ordem. */
const passos = (html: string) => [...html.matchAll(/<li class="([^"]+)"/g)].map((m) => m[1]);

test("trilho: passadas feitas, a atual marcada, gates em losango e a cor do estado", () => {
  const html = trilho("aprovacao_desenho", "aguarda");
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
  assert.match(trilho("registro"), /^<ol class="trilho-fases" /);
});

test("trilho de issue concluída: todas as fases feitas, nenhuma atual", () => {
  const html = trilho("concluida");
  assert.ok(passos(html).every((c) => c?.includes("feito")));
  assert.doesNotMatch(html, /atual|aria-current/);
});

test("página vazia escapa o título e a não encontrada leva ao Início", () => {
  assert.equal(paginaVazia("<b>"), '<div class="cabeca-pagina"><h1>&#60;b&#62;</h1></div>');
  assert.match(NAO_ENCONTRADA, /href="\/home"/);
});

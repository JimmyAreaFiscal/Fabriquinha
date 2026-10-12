import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricasIssuePeriodo, MetricasMes } from "../../../metricas/periodo.ts";
import {
  cardsDoMes,
  contarMeses,
  type DadosDasMetricas,
  dica,
  type EstadoDasMetricas,
  evolucao,
  fraseDoMes,
  media,
  mesDe,
  paginaDeMetricas,
  focoNoPeriodo,
  periodoPadrao,
  proximaOrdem,
  resumo,
  rotuloMes,
  somarMeses,
  tabelaDaEvolucao,
  variacao,
} from "./metricas.ts";

/** O texto visível do HTML, sem tags e com os espaços juntados. */
const texto = (html: string) =>
  html
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

const ETAPAS = ["registro", "desenho", "desenvolvimento", "revisao", "encerramento", "sessao"] as const;
const consumo = (custo: number, input = 0, output = 0, cacheRead = 0, cacheWrite = 0, chamadas = 0) => ({
  chamadas,
  tokens: { input, output, cacheRead, cacheWrite },
  custo,
});

/** Um mês com custo, contagens e nota; as etapas repartem o custo (metade no desenvolvimento). */
function mes(
  m: string,
  custo: number,
  n = 0,
  nota: number | null = null,
  outros: Partial<MetricasMes> = {},
): MetricasMes {
  return {
    mes: m,
    projeto: null,
    consumo: consumo(custo, 1000 * custo),
    modelos: [],
    issues: { registradas: n + 1, concluidas: n },
    tickets: { criados: n + 2, concluidos: n },
    prs: { abertos: n + 1, mergeados: n },
    notaPR: { media: nota, notas: nota === null ? 0 : 2 },
    etapas: ETAPAS.map((etapa) => ({
      etapa,
      ...consumo(etapa === "desenvolvimento" ? custo / 2 : 0, etapa === "desenvolvimento" ? 1000 : 0),
      execucoes: etapa === "desenvolvimento" ? n : 0,
      falhas: 0,
      reprovacoes: 0,
      duracaoMs: etapa === "desenvolvimento" ? n * 60_000 : 0,
    })),
    ...outros,
  };
}

const MESES = [mes("2026-08", 10, 1, 4), mes("2026-09", 20, 3, null), mes("2026-10", 60, 2, 5)];

const ESTADO: EstadoDasMetricas = {
  projeto: "",
  de: "2026-08",
  ate: "2026-10",
  foco: "2026-10",
  metrica: "custo",
  ordem: ["custo", -1],
  tabela: false,
};

const issue = (i: Partial<MetricasIssuePeriodo> & Pick<MetricasIssuePeriodo, "issue">): MetricasIssuePeriodo => ({
  projeto: "loja",
  titulo: `Issue ${String(i.issue)}`,
  fase: "desenvolvimento",
  consumo: consumo(1),
  execucoes: 1,
  falhas: 0,
  reprovacoes: 0,
  duracaoMs: 60_000,
  notaPR: null,
  ...i,
});

const DADOS: DadosDasMetricas = { projetos: ["loja", "site <x>"], meses: MESES, issues: [], atual: "2026-10" };

test("meses: somar, contar, o do instante, o rótulo e o período padrão", () => {
  assert.equal(somarMeses("2026-10", -11), "2025-11");
  assert.equal(somarMeses("2026-12", 1), "2027-01");
  assert.equal(contarMeses("2025-11", "2026-10"), 12);
  assert.equal(mesDe(new Date(2026, 0, 31, 23, 59)), "2026-01");
  assert.equal(rotuloMes("2026-03"), "mar/26");
  assert.deepEqual(periodoPadrao("2026-10"), { de: "2025-11", ate: "2026-10", foco: "2026-10" });
  // O foco fica enquanto o período o contém; fora dele, vai para o último mês.
  assert.equal(focoNoPeriodo({ de: "2025-11", ate: "2026-10", foco: "2026-07" }), "2026-07");
  assert.equal(focoNoPeriodo({ de: "2025-11", ate: "2026-04", foco: "2026-07" }), "2026-04");
  assert.equal(focoNoPeriodo({ de: "2026-08", ate: "2026-10", foco: "2026-07" }), "2026-10");
});

test("números: média sem os vazios e a variação contra a média", () => {
  assert.equal(media([4, null, 5]), 4.5);
  assert.equal(media([null]), null);
  assert.match(variacao(150, 100), /▲ 50%/);
  assert.match(variacao(50, 100), /▼ 50%/);
  assert.match(variacao(100, 100), /= 0%/);
  assert.deepEqual([variacao(null, 1), variacao(1, null), variacao(1, 0)], ["", "", ""]);
});

test("resumo: o mês em foco contra a média dos anteriores do período", () => {
  assert.equal(
    texto(resumo({ de: "2025-11", foco: "2026-10" })),
    "comparando out/26 com a média de 11 meses (nov/25 a set/26)",
  );
  assert.equal(texto(resumo({ de: "2026-09", foco: "2026-10" })), "comparando out/26 com a média de 1 mês (set/26)");
  assert.equal(
    texto(resumo({ de: "2026-10", foco: "2026-10" })),
    "out/26 é o primeiro mês do período: sem média para comparar",
  );
});

test("filtros e régua: projetos escapados, meses dos últimos 36 sem os que passam de 24 e o mês em foco", () => {
  const html = paginaDeMetricas(DADOS, ESTADO);
  assert.match(
    html,
    /<option value="">Todos os projetos<\/option><option value="loja">loja<\/option><option value="site &#60;x&#62;">/,
  );
  const de = /aria-label="De" data-filtro="de">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  assert.equal((de.match(/<option/g) ?? []).length, 36);
  assert.match(de, /value="2023-11" disabled>nov\/23/);
  assert.match(de, /value="2024-11">nov\/24/);
  assert.match(de, /value="2026-08" selected>ago\/26/);
  const ate = /aria-label="Até" data-filtro="ate">([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  assert.match(ate, /value="2026-07" disabled>/);
  assert.match(ate, /value="2026-10" selected>/);
  const regua = /<div class="regua"[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
  assert.match(
    regua,
    /class="mes-btn base" data-mes="2026-08" aria-pressed="false" title="US\$ 10,00"><i style="height:7.0px">/,
  );
  assert.match(
    regua,
    /class="mes-btn" data-mes="2026-10" aria-pressed="true" title="US\$ 60,00"><i style="height:42.0px">/,
  );
  assert.match(paginaDeMetricas({ ...DADOS, projetos: [] }, { ...ESTADO, projeto: "loja" }), /<option value="">Todos/);
  const zerada = paginaDeMetricas({ ...DADOS, meses: [mes("2026-10", 0)] }, { ...ESTADO, de: "2026-10" });
  assert.match(zerada, /<i style="height:3.0px">/);
});

test("cards: valor, média dos anteriores e variação; mês sem nota mostra — e fica fora da média", () => {
  const cards = (e: EstadoDasMetricas) =>
    texto(/<div class="kpis">[\s\S]*?<\/button><\/div>/.exec(paginaDeMetricas(DADOS, e))?.[0] ?? "");
  assert.equal(
    cards(ESTADO),
    "Custo US$ 60,00 média US$ 15,00 ▲ 300% Tokens 60,0 mil média 15,0 mil ▲ 300% " +
      "Issues concluídas 2 de 3 registradas média 2 = 0% Tickets concluídos 2 de 4 criados média 2 = 0% " +
      "PRs mergeados 2 de 3 abertos média 2 = 0% Nota média dos PRs 5,0 de 5 · 2 notas média 4,0 ▲ 25%",
  );
  // Foco em set/26: a média é só de ago/26, e o mês sem nota mostra —.
  assert.match(
    cards({ ...ESTADO, foco: "2026-09" }),
    /Custo US\$ 20,00 média US\$ 10,00 ▲ 100%.*Nota média dos PRs — de 5 · 0 notas média 4,0$/,
  );
  assert.match(cards({ ...ESTADO, foco: "2026-08" }), /^Custo US\$ 10,00 sem meses anteriores Tokens/);
  const semNotas = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-09", 1), mes("2026-10", 1, 1, 3)] },
    { ...ESTADO, de: "2026-09" },
  );
  assert.match(texto(semNotas), /Nota média dos PRs 3,0 de 5 · 2 notas média — Evolução/);
  assert.match(paginaDeMetricas(DADOS, { ...ESTADO, metrica: "nota" }), /data-metrica="nota" aria-pressed="true"/);
  // Média de contagens com uma casa.
  const meia = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-08", 1, 1), mes("2026-09", 1, 2), mes("2026-10", 1, 2)] },
    ESTADO,
  );
  assert.match(texto(meia), /Issues concluídas 2 de 3 registradas média 1,5 ▲ 33%/);
});

test("evolução: colunas no tom de cada mês, linha da média até o foco, valor do foco e o eixo de cada métrica", () => {
  const svg = evolucao(MESES, ESTADO, 800);
  assert.match(svg, /viewBox="0 0 800 210" role="img" aria-label="Evolução de Custo por mês"/);
  assert.equal((svg.match(/class="hit"/g) ?? []).length, 3);
  assert.deepEqual(
    [...svg.matchAll(/fill="(var\(--[a-z]+\))"/g)].map((m) => m[1]),
    ["var(--base)", "var(--base)", "var(--foco)"],
  );
  assert.match(svg, /<line x1="46" x2="[\d.]+" y1="[\d.]+" y2="[\d.]+" stroke="var\(--ink\)" stroke-width="2"/);
  assert.match(svg, /class="rot-media"[^>]*>média US\$ 15,00</);
  assert.match(svg, /class="valor"[^>]*text-anchor="middle">US\$ 60,00</);
  assert.match(svg, />\$60</);
  // Foco no meio: o mês depois dele fica apagado.
  assert.match(evolucao(MESES, { ...ESTADO, foco: "2026-09" }, 800), /fill="var\(--resto\)"/);
  // Primeiro mês: sem média.
  assert.doesNotMatch(evolucao(MESES, { ...ESTADO, foco: "2026-08" }, 800), /rot-media/);
  // Estreito: rótulo de mês alternado, sempre com o do foco; a largura mínima é 300.
  const estreito = evolucao(MESES, { ...ESTADO, foco: "2026-09" }, 100);
  assert.match(estreito, /viewBox="0 0 300 210"/);
  assert.match(estreito, /class="valor">set\/26</);
  assert.doesNotMatch(evolucao(MESES, ESTADO, 300), />set\/26</);
  // Nota: teto 5, e o mês em foco sem nota fica sem coluna e sem valor.
  const nota = evolucao(MESES, { ...ESTADO, metrica: "nota", foco: "2026-09" }, 800);
  assert.match(nota, />5</);
  assert.equal((nota.match(/<path/g) ?? []).length, 2);
  assert.doesNotMatch(nota, /class="valor"[^>]*text-anchor="middle">/);
  // Contagem: o passo não fica abaixo de 1; tudo zerado ainda desenha uma linha de grade.
  assert.match(evolucao(MESES, { ...ESTADO, metrica: "issues" }, 800), />3</);
  const zerado = evolucao([mes("2026-10", 0)], { ...ESTADO, metrica: "tokens", de: "2026-10" }, 800);
  assert.match(zerado, /text-anchor="end">1</);
  assert.match(evolucao([mes("2026-10", 0)], { ...ESTADO, de: "2026-10" }, 800), /text-anchor="end">\$0,5</);
});

test("dica: o valor, o par e, no foco, a média dos anteriores; mês fora do período é defeito", () => {
  assert.deepEqual(dica(MESES, ESTADO, "2026-10"), {
    titulo: "out/26 · em foco",
    linhas: [
      ["var(--foco)", "US$ 60,00", "custo"],
      ["var(--ink)", "US$ 15,00", "média dos anteriores"],
    ],
  });
  assert.deepEqual(dica(MESES, { ...ESTADO, metrica: "nota" }, "2026-09"), {
    titulo: "set/26 · clique para focar",
    linhas: [
      ["var(--foco)", "—", "nota média dos prs"],
      ["var(--muted)", "0", "notas dadas"],
    ],
  });
  assert.equal(dica(MESES, { ...ESTADO, foco: "2026-08" }, "2026-08").linhas.length, 1);
  assert.throws(() => dica(MESES, ESTADO, "2020-01"), /2020-01 está fora do período/);
});

test("ver tabela: os números do gráfico mês a mês, com o par quando há", () => {
  assert.equal(
    texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "prs" })),
    "Mês PRs mergeados abertos ago/26 1 2 set/26 3 4 out/26 · em foco 2 3",
  );
  assert.match(
    texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "issues" })),
    /^Mês Issues concluídas registradas ago\/26 1 2/,
  );
  assert.match(
    texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "tickets" })),
    /^Mês Tickets concluídos criados ago\/26 1 3/,
  );
  assert.equal(texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "nota" })).split(" ")[11], "—");
  assert.equal(
    texto(tabelaDaEvolucao(MESES, ESTADO)),
    "Mês Custo ago/26 US$ 10,00 set/26 US$ 20,00 out/26 · em foco US$ 60,00",
  );
  const pagina = paginaDeMetricas(DADOS, { ...ESTADO, tabela: true });
  assert.match(pagina, /data-tabela>ver gráfico<\/button>[\s\S]*data-evolucao><div class="rola">/);
  assert.match(paginaDeMetricas(DADOS, ESTADO), /data-tabela>ver tabela<\/button>[\s\S]*data-evolucao><\/div>/);
});

test("por etapa: o mês em foco contra a média, com barras duplas e duração média por execução", () => {
  const html = paginaDeMetricas(DADOS, ESTADO);
  const secao = /<h3>out\/26 × média[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  const linhas = [...secao.matchAll(/<tr><td>([\s\S]*?)<\/tr>/g)].map((m) => texto(m[1] ?? ""));
  assert.equal(linhas.length, 6);
  assert.equal(linhas[0], "Registro US$ 0,00 US$ 0,00 0 / 0 0 / 0,0 0 / 0,0 0 / 0,0 — / —");
  assert.equal(
    linhas[2],
    "Desenvolvimento US$ 30,00 US$ 7,50 ▲ 300% 1,0 mil / 1,0 mil 2 / 2,0 0 / 0,0 0 / 0,0 1 min / 1 min",
  );
  assert.match(secao, /width:100.0%;background:var\(--foco\)"><\/i><i style="width:25.0%;background:var\(--base\)/);
  assert.equal(linhas[5]?.split(" ")[0], "Sessão");
  const primeiro = paginaDeMetricas(DADOS, { ...ESTADO, foco: "2026-08" });
  assert.match(texto(primeiro), /Desenvolvimento US\$ 5,00 — 1,0 mil \/ — 1 \/ — 0 \/ — 0 \/ — 1 min \/ —/);
  assert.match(paginaDeMetricas({ ...DADOS, meses: [mes("2026-10", 0)] }, { ...ESTADO, de: "2026-10" }), /width:0.0%/);
});

test("por modelo: custo e tokens por tipo, do mais caro ao mais barato, sem segmento vazio", () => {
  const modelos = [
    { provedor: "llamacpp", modelo: "qwen <3>", ...consumo(0, 100) },
    { provedor: "anthropic", modelo: "claude-opus-5-5", ...consumo(9, 2_000_000, 400_000, 6_000_000, 300_000) },
    { provedor: "anthropic", modelo: "claude-haiku", ...consumo(0, 200) },
  ];
  const html = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-10", 9, 0, null, { modelos })] },
    { ...ESTADO, de: "2026-10" },
  );
  const secao = /<h3>out\/26<\/h3>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.equal(
    texto(secao),
    "out/26 tokens por tipo e custo como o pi calculou cache entrada saída claude-opus-5-5 anthropic US$ 9,00 8,7 M claude-haiku anthropic US$ 0,00 200 qwen &#60;3&#62; llamacpp US$ 0,00 100",
  );
  assert.match(
    secao,
    /<div class="trilha" style="width:100.0%"><i style="flex:6300000;background:var\(--serie-3\)" title="cache 6,3 M"><\/i><i style="flex:2000000;background:var\(--serie-1\)" title="entrada 2,0 M"><\/i><i style="flex:400000;background:var\(--serie-2\)" title="saída 400,0 mil"><\/i><\/div>/,
  );
  assert.match(secao, /style="width:0.0%"><i style="flex:200;background:var\(--serie-1\)"/);
  assert.match(paginaDeMetricas(DADOS, ESTADO), /<p class="muted">Nenhum modelo usado em out\/26.<\/p>/);
  const semTokens = [{ provedor: "p", modelo: "m", ...consumo(0) }];
  const zerado = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-10", 0, 0, null, { modelos: semTokens })] },
    { ...ESTADO, de: "2026-10" },
  );
  assert.match(zerado, /<div class="trilha" style="width:0.0%"><\/div>/);
});

test("por issue: ordenável pelo cabeçalho, com link, projeto só em todos, fase, nota e o total", () => {
  const issues = [
    issue({ issue: 3, titulo: "Busca <b>", consumo: consumo(5, 1000), execucoes: 4, duracaoMs: 3_600_000 }),
    issue({ issue: 12, titulo: null, projeto: "site", fase: "concluida", notaPR: 4, falhas: 1, reprovacoes: 2 }),
    issue({ issue: 7, titulo: "Cache", fase: "registro" }),
  ];
  const ids = (e: Partial<EstadoDasMetricas>) =>
    [...paginaDeMetricas({ ...DADOS, issues }, { ...ESTADO, ...e }).matchAll(/class="id" href="[^"]+">I-(\d+)</g)].map(
      (m) => Number(m[1]),
    );
  assert.deepEqual(ids({}), [3, 12, 7]);
  assert.deepEqual(ids({ ordem: ["issue", 1] }), [3, 7, 12]);
  assert.deepEqual(ids({ ordem: ["titulo", 1] }), [12, 3, 7]);
  assert.deepEqual(ids({ ordem: ["projeto", -1] }), [12, 3, 7]);
  assert.deepEqual(ids({ ordem: ["fase", -1] }), [12, 3, 7]);
  assert.deepEqual(ids({ ordem: ["tokens", -1] }), [3, 12, 7]);
  assert.deepEqual(ids({ ordem: ["duracao", -1] }), [3, 12, 7]);
  assert.deepEqual(ids({ ordem: ["nota", 1] }), [3, 7, 12]);
  assert.deepEqual(ids({ ordem: ["falhas", -1] }), [12, 3, 7]);

  const html = paginaDeMetricas({ ...DADOS, issues }, ESTADO);
  assert.match(
    html,
    /<th class="num ordenavel" aria-sort="descending"><button type="button" data-ordem="custo">Custo<\/button><\/th>/,
  );
  assert.match(
    html,
    /<a class="id" href="\/projects\/site\/issues\/I-12">I-12<\/a><\/td>\s*<td><span class="muted">sem título<\/span><\/td>\s*<td class="muted">site<\/td>\s*<td><span class="pill pill-ok">Concluída<\/span>/,
  );
  assert.match(html, /Busca &#60;b&#62;/);
  assert.match(html, /<span class="pill fase">Desenvolvimento<\/span>/);
  assert.equal(texto(/<tfoot>[\s\S]*?<\/tfoot>/.exec(html)?.[0] ?? ""), "3 issues US$ 7,00 1,0 mil 6 1 2 1 h 2 min");
  assert.match(html, /a out\/26 · todos os projetos · clique/);

  const loja = paginaDeMetricas({ ...DADOS, issues }, { ...ESTADO, projeto: "loja", ordem: ["custo", 1] });
  assert.doesNotMatch(loja, /data-ordem="projeto"/);
  assert.match(loja, /aria-sort="ascending"/);
  assert.match(loja, /<td colspan="3">3 issues/);
  assert.match(loja, /· loja · clique/);
  assert.match(paginaDeMetricas(DADOS, ESTADO), /Nenhuma issue com execução no período./);
});

test("próxima ordem: a mesma coluna inverte; outra começa crescente no texto, na issue e na fase", () => {
  assert.deepEqual(proximaOrdem(["custo", -1], "custo"), ["custo", 1]);
  assert.deepEqual(proximaOrdem(["custo", 1], "custo"), ["custo", -1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "titulo"), ["titulo", 1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "issue"), ["issue", 1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "fase"), ["fase", 1]);
  assert.deepEqual(proximaOrdem(["titulo", 1], "execucoes"), ["execucoes", -1]);
});

test("Início e Projeto: a frase e os 5 cards do mês corrente", () => {
  const m = mes("2026-10", 38.42, 7, null, { consumo: consumo(38.42, 2_200_000, 400_000, 6_000_000, 300_000, 902) });
  assert.equal(
    texto(fraseDoMes(m)),
    "Outubro de 2026, todos os projetos: US$ 38,42 · 8,9 M tokens · issues 8 registradas, 7 concluídas · tickets 9 criados, 7 concluídos · PRs 8 abertos, 7 mergeados Métricas →",
  );
  assert.match(fraseDoMes(m), /<a href="\/metrics">Métricas →<\/a>/);
  assert.equal(
    texto(cardsDoMes(m)),
    "Custo · outubro US$ 38,42 902 chamadas de LLM Tokens 8,9 M 2,2 M entrada · 400,0 mil saída · 6,3 M cache Issues 8 / 7 registradas / concluídas Tickets 9 / 7 criados / concluídos PRs 8 / 7 abertos / mergeados",
  );
  assert.match(cardsDoMes(mes("2026-01", 0, 0, null, { consumo: consumo(0, 0, 0, 0, 0, 1) })), /1 chamada de LLM/);
});

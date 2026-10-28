import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricasDemandaPeriodo, MetricasMesDemanda, Nivel, Soma } from "../../../metricas/periodo_demanda.ts";
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

const ETAPAS = [
  "demanda",
  "planejar",
  "implementar",
  "revisar_rodada",
  "encerrar_rodada",
  "sessao_em_aberto",
  "revisar_demanda",
  "encerrar_demanda",
  "resolver_conflito",
] as const;
const consumo = (custo: number, entrada = 0, saida = 0, cacheLeitura = 0, cacheEscrita = 0, execucoes = 0): Soma => ({
  execucoes,
  falhas: 0,
  duracaoMs: 0,
  tokens: { entrada, saida, cacheLeitura, cacheEscrita },
  custo: { conhecido: custo, incompleto: false },
});

/** Um mês com custo, contagens e nota; as etapas repartem o custo (metade no desenvolvimento). */
function mes(
  m: string,
  custo: number,
  n = 0,
  nota: number | null = null,
  outros: Partial<MetricasMesDemanda> = {},
): MetricasMesDemanda {
  return {
    mes: m,
    projeto: null,
    total: { ...consumo(custo, 1000 * custo), modelos: [] },
    niveis: [],
    demandas: { registradas: n + 1, concluidas: n },
    tickets: { criados: n + 2, concluidos: n },
    prs: { abertos: n + 1, mergeados: n },
    nota: { media: nota, notas: nota === null ? 0 : 2 },
    retrabalho: { adicionadas: 100, alteradas: 10 * n, porHumanos: n },
    etapas: ETAPAS.map((etapa) => ({
      etapa,
      ...consumo(etapa === "implementar" ? custo / 2 : 0, etapa === "implementar" ? 1000 : 0),
      execucoes: etapa === "implementar" ? n : 0,
      reprovacoes: 0,
      duracaoMs: etapa === "implementar" ? n * 60_000 : 0,
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

const demanda = (
  d: Partial<MetricasDemandaPeriodo> & Pick<MetricasDemandaPeriodo, "demanda">,
): MetricasDemandaPeriodo => ({
  projeto: "loja",
  titulo: `Demanda ${d.demanda}`,
  fase: "execucao",
  ...consumo(1, 0, 0, 0, 0, 1),
  duracaoMs: 60_000,
  reprovacoes: 0,
  nota: null,
  ...d,
});

const DADOS: DadosDasMetricas = { projetos: ["loja", "site <x>"], meses: MESES, demandas: [], atual: "2026-10" };

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
      "Demandas concluídas 2 de 3 registradas média 2 = 0% Tickets concluídos 2 de 4 criados média 2 = 0% " +
      "PRs mergeados 2 de 3 abertos média 2 = 0% Nota média dos PRs 5,0 de 5 · 2 notas média 4,0 ▲ 25% " +
      "Retrabalho (linhas) 20 de 100 adicionadas média 20 = 0%",
  );
  // Foco em set/26: a média é só de ago/26, e o mês sem nota mostra —.
  assert.match(
    cards({ ...ESTADO, foco: "2026-09" }),
    /Custo US\$ 20,00 média US\$ 10,00 ▲ 100%.*Nota média dos PRs — de 5 · 0 notas média 4,0 Retrabalho/,
  );
  assert.match(cards({ ...ESTADO, foco: "2026-08" }), /^Custo US\$ 10,00 sem meses anteriores Tokens/);
  const semNotas = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-09", 1), mes("2026-10", 1, 1, 3)] },
    { ...ESTADO, de: "2026-09" },
  );
  assert.match(texto(semNotas), /Nota média dos PRs 3,0 de 5 · 2 notas média — Retrabalho/);
  assert.match(paginaDeMetricas(DADOS, { ...ESTADO, metrica: "nota" }), /data-metrica="nota" aria-pressed="true"/);
  // Média de contagens com uma casa.
  const meia = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-08", 1, 1), mes("2026-09", 1, 2), mes("2026-10", 1, 2)] },
    ESTADO,
  );
  assert.match(texto(meia), /Demandas concluídas 2 de 3 registradas média 1,5 ▲ 33%/);
  // As legendas "de N" com o separador de milhar, como os outros números.
  const milhares = paginaDeMetricas(
    {
      ...DADOS,
      meses: [
        mes("2026-10", 1, 24_929, null, {
          retrabalho: { adicionadas: 289_424, alteradas: 24_929, porHumanos: 0 },
        }),
      ],
    },
    { ...ESTADO, de: "2026-10" },
  );
  assert.match(
    texto(milhares),
    /24\.929 de 24\.930 registradas .* 24\.929 de 24\.931 criados .* 24\.929 de 24\.930 abertos .* 24\.929 de 289\.424 adicionadas/,
  );
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
  assert.match(evolucao(MESES, { ...ESTADO, metrica: "demandas" }, 800), />3</);
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
    texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "demandas" })),
    /^Mês Demandas concluídas registradas ago\/26 1 2/,
  );
  assert.match(
    texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "tickets" })),
    /^Mês Tickets concluídos criados ago\/26 1 3/,
  );
  assert.equal(texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "nota" })).split(" ")[11], "—");
  assert.match(
    texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "retrabalho" })),
    /^Mês Retrabalho \(linhas\) linhas adicionadas ago\/26 10 100/,
  );
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
  assert.equal(linhas.length, 10);
  assert.equal(linhas[0], "Demanda US$ 0,00 US$ 0,00 0 / 0 0 / 0,0 0 / 0,0 0 / 0,0 — / —");
  assert.equal(
    linhas[2],
    "Implementar US$ 30,00 US$ 7,50 ▲ 300% 1,0 mil / 1,0 mil 2 / 2,0 0 / 0,0 0 / 0,0 1 min / 1 min",
  );
  // Total: custo com média e Δ, contagens somadas (mês / soma das médias) e duração ponderada pelas execuções.
  assert.equal(linhas[9], "Total US$ 30,00 US$ 7,50 ▲ 300% 1,0 mil / 1,0 mil 2 / 2,0 0 / 0,0 0 / 0,0 1 min / 1 min");
  assert.match(secao, /width:100.0%;background:var\(--foco\)"><\/i><i style="width:25.0%;background:var\(--base\)/);
  assert.equal(linhas[5]?.split(" ").slice(0, 3).join(" "), "Sessão em aberto");
  // Primeiro mês: sem média, e o Total também mostra —.
  const primeiro = paginaDeMetricas(DADOS, { ...ESTADO, foco: "2026-08" });
  assert.match(texto(primeiro), /Implementar US\$ 5,00 — 1,0 mil \/ — 1 \/ — 0 \/ — 0 \/ — 1 min \/ —/);
  assert.match(texto(primeiro), /Total US\$ 5,00 — 1,0 mil \/ — 1 \/ — 0 \/ — 0 \/ — 1 min \/ —/);
  // A duração da média é ponderada pelas execuções: (1 min + 6 min) / 4 = 1 min 45 s, não a média simples de 1 e 2 min.
  const comDuracao = (m: string, execucoes: number, duracaoMs: number) =>
    mes(m, 1, 0, null, {
      etapas: mes(m, 1).etapas.map((x) => (x.etapa === "implementar" ? { ...x, execucoes, duracaoMs } : x)),
    });
  const pesada = paginaDeMetricas(
    {
      ...DADOS,
      meses: [comDuracao("2026-08", 1, 60_000), comDuracao("2026-09", 3, 360_000), comDuracao("2026-10", 0, 0)],
    },
    ESTADO,
  );
  assert.match(texto(/<tfoot>[\s\S]*?<\/tfoot>/.exec(pesada)?.[0] ?? ""), /— \/ 1 min 45 s$/);
  // Custo incompleto leva *, no mês e no Total, e o card avisa.
  const incompleto = mes("2026-10", 1, 1, null, {
    total: { ...consumo(1), custo: { conhecido: 1, incompleto: true }, modelos: [] },
    etapas: mes("2026-10", 1, 1).etapas.map((x) =>
      x.etapa === "implementar" ? { ...x, custo: { conhecido: 0.5, incompleto: true } } : x,
    ),
  });
  const parcial = paginaDeMetricas({ ...DADOS, meses: [incompleto] }, { ...ESTADO, de: "2026-10" });
  assert.match(texto(parcial), /Implementar US\$ 0,50 \* /);
  assert.match(texto(parcial), /Total US\$ 0,50 \* /);
  assert.match(texto(parcial), /Custo US\$ 1,00 \* custo incompleto/);
});

test("por nível: cada nível do agrupamento com a soma do mês, e o retrabalho do mês", () => {
  const nivel = (n: Nivel, grupos: number, custo: Soma["custo"]) => ({
    nivel: n,
    grupos,
    total: { ...consumo(0, 100, 20, 30, 40, 5), custo },
  });
  const niveis = [
    nivel("execucao", 5, { conhecido: 2, incompleto: false }),
    nivel("sessao", 3, { conhecido: 2, incompleto: true }),
    nivel("ticket", 3, { conhecido: 2, incompleto: true }),
    nivel("rodada", 2, { conhecido: 2, incompleto: true }),
    nivel("demanda", 1, { conhecido: 2, incompleto: true }),
    nivel("projeto", 1, { conhecido: 2, incompleto: true }),
  ];
  const html = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-10", 2, 1, null, { niveis })] },
    { ...ESTADO, de: "2026-10" },
  );
  const secao = /<h2>Por nível<\/h2>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.equal(
    texto(secao),
    "Por nível out/26 execução → sessão → ticket → rodada → demanda → projeto: a soma de cada nível é o total do mês " +
      "Nível Grupos Execuções Tokens Custo Execução 5 5 190 US$ 2,00 Sessão 3 5 190 US$ 2,00 * Ticket 3 5 190 US$ 2,00 * " +
      "Rodada 2 5 190 US$ 2,00 * Demanda 1 5 190 US$ 2,00 * Projeto 1 5 190 US$ 2,00 * " +
      "Retrabalho: 10 de 100 linhas escritas no mês foram alteradas depois (1 por humanos). * há execução sem custo informado.",
  );
});

test("por modelo: custo e tokens por tipo, do mais caro ao mais barato, custo desconhecido à parte e sem segmento vazio", () => {
  const uso = (modelo: string, provedor: string, custo: number | null, entrada = 0, saida = 0, cl = 0, ce = 0) => ({
    provedor,
    modelo,
    entrada,
    saida,
    cacheLeitura: cl,
    cacheEscrita: ce,
    custo,
  });
  const modelos = [
    uso("qwen <3>", "llamacpp", 0, 100),
    uso("claude-opus-5-5", "anthropic", 9, 2_000_000, 400_000, 6_000_000, 300_000),
    uso("claude-haiku", "anthropic", 0, 200),
    uso("local", "llamacpp", null, 50),
    uso("local-2", "llamacpp", null, 40),
  ];
  const html = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-10", 9, 0, null, { total: { ...consumo(9), modelos } })] },
    { ...ESTADO, de: "2026-10" },
  );
  const secao = /<h3>out\/26<\/h3><span class="sub">tokens por tipo[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.equal(
    texto(secao),
    "out/26 tokens por tipo e custo como o pi calculou cache entrada saída claude-opus-5-5 anthropic US$ 9,00 8,7 M claude-haiku anthropic US$ 0,00 200 qwen &#60;3&#62; llamacpp US$ 0,00 100 local llamacpp custo desconhecido 50 local-2 llamacpp custo desconhecido 40",
  );
  assert.match(
    secao,
    /<div class="trilha" style="width:100.0%"><i style="flex:6300000;background:var\(--serie-3\)" title="cache 6,3 M"><\/i><i style="flex:2000000;background:var\(--serie-1\)" title="entrada 2,0 M"><\/i><i style="flex:400000;background:var\(--serie-2\)" title="saída 400,0 mil"><\/i><\/div>/,
  );
  assert.match(secao, /style="width:0.0%"><i style="flex:200;background:var\(--serie-1\)"/);
  assert.match(paginaDeMetricas(DADOS, ESTADO), /<p class="muted">Nenhum modelo usado em out\/26.<\/p>/);
  const semTokens = [uso("m", "p", 0)];
  const zerado = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-10", 0, 0, null, { total: { ...consumo(0), modelos: semTokens } })] },
    { ...ESTADO, de: "2026-10" },
  );
  assert.match(zerado, /<div class="trilha" style="width:0.0%"><\/div>/);
});

test("por demanda: ordenável pelo cabeçalho, com link, projeto só em todos, fase, nota e o total", () => {
  const demandas = [
    demanda({
      demanda: "I-3",
      titulo: "Busca <b>",
      ...consumo(5, 1000, 0, 0, 0, 4),
      duracaoMs: 3_600_000,
    }),
    demanda({
      demanda: "I-12",
      projeto: "site",
      fase: "aprovacao_demanda",
      nota: 4,
      falhas: 1,
      reprovacoes: 2,
      custo: { conhecido: 1, incompleto: true },
    }),
    demanda({ demanda: "I-7", titulo: "Cache", fase: "concluida" }),
  ];
  const ids = (e: Partial<EstadoDasMetricas>) =>
    [
      ...paginaDeMetricas({ ...DADOS, demandas }, { ...ESTADO, ...e }).matchAll(/class="id" href="[^"]+">(I-\d+)</g),
    ].map((m) => m[1]);
  assert.deepEqual(ids({}), ["I-3", "I-12", "I-7"]);
  assert.deepEqual(ids({ ordem: ["demanda", 1] }), ["I-3", "I-7", "I-12"]);
  assert.deepEqual(ids({ ordem: ["titulo", 1] }), ["I-3", "I-7", "I-12"]);
  assert.deepEqual(ids({ ordem: ["projeto", -1] }), ["I-12", "I-3", "I-7"]);
  assert.deepEqual(ids({ ordem: ["fase", 1] }), ["I-12", "I-7", "I-3"]);
  assert.deepEqual(ids({ ordem: ["tokens", -1] }), ["I-3", "I-12", "I-7"]);
  assert.deepEqual(ids({ ordem: ["duracao", -1] }), ["I-3", "I-12", "I-7"]);
  assert.deepEqual(ids({ ordem: ["nota", 1] }), ["I-3", "I-7", "I-12"]);
  assert.deepEqual(ids({ ordem: ["falhas", -1] }), ["I-12", "I-3", "I-7"]);

  const html = paginaDeMetricas({ ...DADOS, demandas }, ESTADO);
  assert.match(
    html,
    /<th class="num ordenavel" aria-sort="descending"><button type="button" data-ordem="custo">Custo<\/button><\/th>/,
  );
  assert.match(
    html,
    /<a class="id" href="\/demandas\/I-12">I-12<\/a><\/td>\s*<td>Demanda I-12<\/td>\s*<td class="muted">site<\/td>\s*<td><span class="pill pill-aguarda">Aprovação da demanda<\/span>/,
  );
  assert.match(html, /<td class="num">US\$ 1,00 \*<\/td>/);
  assert.match(html, /<td class="num">4,0<\/td>/);
  assert.match(html, /Busca &#60;b&#62;/);
  assert.match(html, /<span class="pill pill-ok">Concluída<\/span>/);
  assert.doesNotMatch(html, /Iterações/);
  assert.equal(
    texto(/<tfoot>(?:(?!<tfoot>)[\s\S])*?<\/tfoot>(?![\s\S]*<tfoot>)/.exec(html)?.[0] ?? ""),
    "3 demandas US$ 7,00 * 1,0 mil 6 1 2 1 h 2 min",
  );
  assert.match(html, /a out\/26 · todos os projetos · clique/);

  const loja = paginaDeMetricas({ ...DADOS, demandas }, { ...ESTADO, projeto: "loja", ordem: ["custo", 1] });
  assert.doesNotMatch(loja, /data-ordem="projeto"/);
  assert.match(loja, /aria-sort="ascending"/);
  assert.match(loja, /<td colspan="3">3 demandas/);
  assert.match(loja, /· loja · clique/);
  assert.match(paginaDeMetricas(DADOS, ESTADO), /Nenhuma demanda com execução no período./);
});

test("próxima ordem: a mesma coluna inverte; outra começa crescente no texto, na demanda e na fase", () => {
  assert.deepEqual(proximaOrdem(["custo", -1], "custo"), ["custo", 1]);
  assert.deepEqual(proximaOrdem(["custo", 1], "custo"), ["custo", -1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "titulo"), ["titulo", 1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "demanda"), ["demanda", 1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "fase"), ["fase", 1]);
  assert.deepEqual(proximaOrdem(["titulo", 1], "execucoes"), ["execucoes", -1]);
});

test("Início e Projeto: a frase e os 6 cards do mês corrente", () => {
  const m = mes("2026-10", 38.42, 7, null, {
    total: { ...consumo(38.42, 2_200_000, 400_000, 6_000_000, 300_000, 902), modelos: [] },
  });
  assert.equal(
    texto(fraseDoMes(m)),
    "Outubro de 2026, todos os projetos: US$ 38,42 · 8,9 M tokens · demandas 8 registradas, 7 concluídas · tickets 9 criados, 7 concluídos · PRs 8 abertos, 7 mergeados Métricas →",
  );
  assert.match(fraseDoMes(m), /<a href="\/metrics">Métricas →<\/a>/);
  assert.equal(
    texto(cardsDoMes(m)),
    "Custo · outubro US$ 38,42 902 execuções Tokens 8,9 M 2,2 M entrada · 400,0 mil saída · 6,3 M cache Demandas 8 / 7 registradas / concluídas Tickets 9 / 7 criados / concluídos PRs 8 / 7 abertos / mergeados Retrabalho 70 / 100 linhas alteradas / adicionadas",
  );
  assert.match(
    cardsDoMes(mes("2026-01", 0, 0, null, { total: { ...consumo(0, 0, 0, 0, 0, 1), modelos: [] } })),
    /1 execução</,
  );
  const parcial = { ...m, total: { ...m.total, custo: { conhecido: 1, incompleto: true } } };
  assert.match(texto(fraseDoMes(parcial)), /US\$ 1,00 \* ·/);
});

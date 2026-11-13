import assert from "node:assert/strict";
import { test } from "node:test";
import type { TipoMetrica } from "../../../../modulos/etapas/definicao/tipos_declaraveis.ts";
import type { EtapaTicket } from "../../../../modulos/etapas/catalogo.ts";
import type { MetricasDasDemandas, MetricasDoMes } from "../../../contrato/metricas.ts";
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
import { descreverEtapasDoSdlc } from "../../../consultas/etapas.ts";
import { definirEtapasDoSdlc } from "../../apresentacao/etapas.ts";

definirEtapasDoSdlc(descreverEtapasDoSdlc());

/** O texto visível do HTML, sem tags e com os espaços juntados. */
const texto = (html: string) =>
  html
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

type MetricasDaDemandaNoPeriodo = MetricasDasDemandas["demandas"][number];
type Nivel = MetricasDoMes["niveis"][number]["nivel"];
type Soma = Omit<MetricasDoMes["total"], "modelos">;

const consumo = (custo: number, entrada = 0, saida = 0, cacheLeitura = 0, cacheEscrita = 0, execucoes = 0): Soma => ({
  execucoes,
  falhas: 0,
  duracaoMs: 0,
  tokens: { entrada, saida, cacheLeitura, cacheEscrita, total: entrada + saida + cacheLeitura + cacheEscrita },
  custo: { conhecido: custo, trabalhosSemCusto: 0 },
  textoDoCusto: `US$ ${custo.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
});

const DEFINICOES: Record<TipoMetrica, { tipo: TipoMetrica; rotulo: string; fonte: string }> = {
  uso: { tipo: "uso", rotulo: "Uso", fonte: "Uso" },
  aprovacoes_e_reprovacoes: {
    tipo: "aprovacoes_e_reprovacoes",
    rotulo: "Reprovações no Gate",
    fonte: "Gate da demanda",
  },
  conformidade_com_o_plano: {
    tipo: "conformidade_com_o_plano",
    rotulo: "Conformidade do PR com o plano",
    fonte: "Plano × arquivos alterados",
  },
  alteracoes_posteriores: {
    tipo: "alteracoes_posteriores",
    rotulo: "Alterações posteriores no código",
    fonte: "Commits humanos posteriores na base",
  },
  exigencias_de_alteracao: {
    tipo: "exigencias_de_alteracao",
    rotulo: "Exigências de alteração",
    fonte: "Decisões de reprovação e Tentativas",
  },
  bugs_nos_arquivos_revisados: {
    tipo: "bugs_nos_arquivos_revisados",
    rotulo: "Bugs nos arquivos revisados",
    fonte: "Commits humanos posteriores na base",
  },
  nota_humana: { tipo: "nota_humana", rotulo: "Nota humana", fonte: "Gate do PR" },
};

/** As Métricas de cada Etapa, na ordem do fluxo da demanda. */
const METRICAS_DAS_ETAPAS: Record<EtapaTicket, TipoMetrica[]> = {
  entender_e_desenhar: ["uso", "aprovacoes_e_reprovacoes"],
  planejar: ["uso", "conformidade_com_o_plano"],
  implementar: ["uso", "alteracoes_posteriores"],
  revisar_rodada: ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"],
  encerrar_rodada: ["uso", "nota_humana"],
  ajustar_resultado: ["uso"],
  revisar_demanda: ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"],
  encerrar_demanda: ["uso"],
  resolver_conflito: ["uso"],
};

/** O valor de cada Métrica quando a Etapa não tem nada a mostrar. */
const USO_VAZIO = { ...consumo(0), modelos: [], custoExterno: { conhecido: 0, trabalhosSemCusto: 0, sessoes: 0 } };
const VALORES_VAZIOS: Record<TipoMetrica, unknown> = {
  uso: USO_VAZIO,
  aprovacoes_e_reprovacoes: { aprovacoes: 0, reprovacoes: 0 },
  conformidade_com_o_plano: { percentual: null, comuns: 0, uniao: 0, rodadas: [] },
  alteracoes_posteriores: { adicionadas: 0, alteradasPorHumanos: 0 },
  exigencias_de_alteracao: { reprovacoes: 0 },
  bugs_nos_arquivos_revisados: { alteradasPorHumanos: 0 },
  nota_humana: { soma: 0, quantidade: 0, media: null },
};

/** O Uso de uma Etapa com o custo, as execuções e os tokens de entrada dados; o resto é zero. */
const uso = (custo: number, execucoes = 0, entrada = 0, resto: Record<string, unknown> = {}) => ({
  ...USO_VAZIO,
  ...consumo(custo, entrada, 0, 0, 0, execucoes),
  ...resto,
});

type ValoresDasEtapas = Partial<Record<EtapaTicket, Partial<Record<TipoMetrica, unknown>>>>;

/** As nove Etapas, cada uma com as Métricas que o catálogo declara para ela, com os `valores` dados e zero no resto. */
const etapas = (valores: ValoresDasEtapas = {}): MetricasDoMes["etapas"] =>
  (Object.keys(METRICAS_DAS_ETAPAS) as EtapaTicket[]).map((etapa) => ({
    etapa,
    metricas: METRICAS_DAS_ETAPAS[etapa].map((tipo) => ({
      definicao: DEFINICOES[tipo],
      valor: valores[etapa]?.[tipo] ?? VALORES_VAZIOS[tipo],
    })),
  })) as MetricasDoMes["etapas"];

/** Um mês com custo, contagens e nota; a implementação concentra o custo e os tokens, como o total do mês. */
function mes(
  m: string,
  custo: number,
  n = 0,
  nota: number | null = null,
  outros: Partial<MetricasDoMes> = {},
): MetricasDoMes {
  return {
    mes: m,
    projeto: null,
    etapas: etapas({
      implementar: {
        uso: uso(custo, n, 1000 * custo, { duracaoMs: n * 60_000 }),
        alteracoes_posteriores: { adicionadas: 100, alteradasPorHumanos: n },
      },
      encerrar_rodada: {
        nota_humana: { soma: nota === null ? 0 : 2 * nota, quantidade: nota === null ? 0 : 2, media: nota },
      },
    }),
    total: { ...consumo(custo, 1000 * custo), modelos: [] },
    niveis: [],
    demandas: { registradas: n + 1, concluidas: n },
    tickets: { criados: n + 2, concluidos: n },
    prs: { abertos: n + 1, mergeados: n },
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
  d: Partial<MetricasDaDemandaNoPeriodo> & Pick<MetricasDaDemandaNoPeriodo, "demanda">,
): MetricasDaDemandaNoPeriodo => ({
  projeto: "loja",
  titulo: `Demanda ${d.demanda}`,
  estado: "em_execucao",
  ...consumo(1, 0, 0, 0, 0, 1),
  duracaoMs: 60_000,
  reprovacoes: 0,
  conformidade: null,
  nota: null,
  ...d,
});

const DADOS: DadosDasMetricas = {
  projetos: ["loja", "site <x>"],
  meses: MESES,
  demandas: [],
  totalDasDemandas: { ...consumo(0), conformidade: null, nota: null },
  atual: "2026-10",
};

// O mês sai no fuso do navegador; aqui, um fuso fixo.
process.env.TZ = "America/Sao_Paulo";

test("meses: somar, contar, o do instante, o rótulo e o período padrão", () => {
  assert.equal(somarMeses("2026-10", -11), "2025-11");
  assert.equal(somarMeses("2026-12", 1), "2027-01");
  assert.equal(contarMeses("2025-11", "2026-10"), 12);
  assert.equal(mesDe(Date.parse("2026-01-31T23:59:00-03:00")), "2026-01");
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
      "PRs mergeados 2 de 3 abertos média 2 = 0% Nota humana média 5,0 de 5 · 2 notas média 4,0 ▲ 25% " +
      "Alterações posteriores (linhas) 2 de 100 adicionadas média 2 = 0%",
  );
  // Foco em set/26: a média é só de ago/26, e o mês sem nota mostra —.
  assert.match(
    cards({ ...ESTADO, foco: "2026-09" }),
    /Custo US\$ 20,00 média US\$ 10,00 ▲ 100%.*Nota humana média — de 5 · 0 notas média 4,0 Alterações posteriores/,
  );
  assert.match(cards({ ...ESTADO, foco: "2026-08" }), /^Custo US\$ 10,00 sem meses anteriores Tokens/);
  const semNotas = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-09", 1), mes("2026-10", 1, 1, 3)] },
    { ...ESTADO, de: "2026-09" },
  );
  assert.match(texto(semNotas), /Nota humana média 3,0 de 5 · 2 notas média — Alterações posteriores/);
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
          etapas: etapas({
            implementar: { alteracoes_posteriores: { adicionadas: 289_424, alteradasPorHumanos: 24_929 } },
          }),
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
      ["var(--foco)", "—", "nota humana média"],
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
  assert.match(texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "nota" })), /set\/26 — 0 out\/26/);
  assert.match(
    texto(tabelaDaEvolucao(MESES, { ...ESTADO, metrica: "alteracoes" })),
    /^Mês Alterações posteriores \(linhas\) linhas adicionadas ago\/26 1 100/,
  );
  assert.equal(
    texto(tabelaDaEvolucao(MESES, ESTADO)),
    "Mês Custo ago/26 US$ 10,00 set/26 US$ 20,00 out/26 · em foco US$ 60,00",
  );
  const pagina = paginaDeMetricas(DADOS, { ...ESTADO, tabela: true });
  assert.match(pagina, /data-tabela>ver gráfico<\/button>[\s\S]*data-evolucao><div class="rola">/);
  assert.match(paginaDeMetricas(DADOS, ESTADO), /data-tabela>ver tabela<\/button>[\s\S]*data-evolucao><\/div>/);
});

/** As seções de Etapa da página, com o texto de cada uma. */
const secoesDaPagina = (html: string) =>
  [
    ...html.matchAll(/<section class="grafico superficie etapa-metricas" aria-label="([^"]+)">([\s\S]*?)<\/section>/g),
  ].map((m) => ({ titulo: m[1] ?? "", html: m[2] ?? "", texto: texto(m[2] ?? "") }));

test("por etapa: uma seção para cada uma das nove Etapas, com o título, o modo e as Métricas que o catálogo declara", () => {
  const secoes = secoesDaPagina(paginaDeMetricas(DADOS, ESTADO));
  const rotulos = (html: string) => [...html.matchAll(/<span class="rotulo">([^<]*)<\/span>/g)].map((m) => m[1]);
  const revisao = ["Exigências de alteração", "Bugs nos arquivos revisados", "Uso"];
  assert.deepEqual(
    secoes.map((s) => [s.titulo, rotulos(s.html)]),
    [
      ["Entender e desenhar", ["Reprovações no Gate", "Uso"]],
      ["Planejar", ["Conformidade do PR com o plano", "Uso"]],
      ["Implementar", ["Alterações posteriores no código", "Uso"]],
      ["Revisar rodada", revisao],
      ["Encerrar rodada", ["Nota humana", "Uso"]],
      ["Revisar demanda", revisao],
      ["Encerrar demanda", ["Uso"]],
      ["Resolver conflito", ["Uso"]],
      ["Ajustar Resultado", ["Uso"]],
    ],
  );
  assert.deepEqual(
    secoes.map((s) => /<span class="sub">([^<]*)<\/span>/.exec(s.html)?.[1]),
    [
      "Não Gerenciado · por Demanda",
      "Gerenciado · por Demanda",
      "Gerenciado · por Rodada",
      "Gerenciado · por Rodada",
      "Gerenciado · por Rodada",
      "Gerenciado · por Demanda",
      "Fabriquinha · por Demanda",
      "Gerenciado · por Demanda",
      "Gerenciado (interativo) · por Rodada",
    ],
  );
  // A Etapa que só tem Uso diz isso, e a fonte de cada Métrica vem do servidor.
  assert.equal((secoes[6]?.html.match(/Só Uso: o catálogo não declara outra Métrica\./g) ?? []).length, 1);
  assert.match(secoes[1]?.texto ?? "", /Plano × arquivos alterados/);
  assert.match(secoes[4]?.texto ?? "", /Gate do PR/);
  const html = paginaDeMetricas(DADOS, ESTADO);
  assert.match(
    html,
    /<h2>Por etapa<\/h2><span class="muted">out\/26 · as Métricas de Sucesso de cada Etapa e o Uso, contra a média dos meses anteriores<\/span>/,
  );
});

test("por etapa: o valor de cada Métrica de Sucesso contra a média dos meses anteriores, e — onde não há o que medir", () => {
  const anterior: ValoresDasEtapas = {
    entender_e_desenhar: { aprovacoes_e_reprovacoes: { aprovacoes: 1, reprovacoes: 1 } },
    planejar: { conformidade_com_o_plano: { percentual: 71, comuns: 1, uniao: 1, rodadas: [] } },
    implementar: { alteracoes_posteriores: { adicionadas: 1000, alteradasPorHumanos: 600 } },
    revisar_rodada: {
      exigencias_de_alteracao: { reprovacoes: 3 },
      bugs_nos_arquivos_revisados: { alteradasPorHumanos: 4 },
    },
    encerrar_rodada: { nota_humana: { soma: 8, quantidade: 2, media: 4 } },
  };
  const atual: ValoresDasEtapas = {
    entender_e_desenhar: { aprovacoes_e_reprovacoes: { aprovacoes: 5, reprovacoes: 2 } },
    planejar: {
      conformidade_com_o_plano: {
        percentual: 78,
        comuns: 7,
        uniao: 9,
        rodadas: Array.from({ length: 9 }, () => ({}) as never),
      },
    },
    implementar: { alteracoes_posteriores: { adicionadas: 13_904, alteradasPorHumanos: 312 } },
    revisar_rodada: {
      exigencias_de_alteracao: { reprovacoes: 1 },
      bugs_nos_arquivos_revisados: { alteradasPorHumanos: 0 },
    },
    encerrar_rodada: { nota_humana: { soma: 9, quantidade: 2, media: 4.5 } },
  };
  const pagina = (m: ValoresDasEtapas, anteriores: ValoresDasEtapas[] = [anterior]) =>
    secoesDaPagina(
      paginaDeMetricas(
        {
          ...DADOS,
          meses: [
            ...anteriores.map((v, i) => mes(`2026-0${String(i + 1)}`, 0, 0, null, { etapas: etapas(v) })),
            mes("2026-10", 0, 0, null, { etapas: etapas(m) }),
          ],
        },
        { ...ESTADO, de: "2026-01" },
      ),
    );
  const secoes = pagina(atual);
  assert.match(
    secoes[0]?.texto ?? "",
    /^Entender e desenhar .* Reprovações no Gate 2 de 7 Gates · 5 aprovações média 1 ▲ 100% Gate da demanda/,
  );
  assert.match(
    secoes[1]?.texto ?? "",
    /Conformidade do PR com o plano 0,78 Jaccard médio · 9 PRs média 0,71 ▲ 10% Plano × arquivos alterados/,
  );
  assert.match(
    secoes[2]?.texto ?? "",
    /Alterações posteriores no código 312 de 13\.904 linhas adicionadas média 600 ▼ 48% Commits humanos posteriores na base/,
  );
  assert.match(
    secoes[3]?.texto ?? "",
    /Exigências de alteração 1 reprovação média 3 ▼ 67% .* Bugs nos arquivos revisados 0 linhas alteradas por humanos média 4 ▼ 100%/,
  );
  assert.match(secoes[4]?.texto ?? "", /Nota humana 4,5 de 5 · 2 notas média 4,0 ▲ 13% Gate do PR/);
  // Sem nota e sem conformidade o valor é —; sem meses anteriores, a média não existe; média só dos meses com valor.
  const vazio = pagina({}, []);
  assert.match(vazio[4]?.texto ?? "", /Nota humana — de 5 · 0 notas sem meses anteriores/);
  assert.match(vazio[1]?.texto ?? "", /Conformidade do PR com o plano — Jaccard médio · 0 PRs sem meses anteriores/);
  assert.match(pagina({}, [{}])[4]?.texto ?? "", /Nota humana — de 5 · 0 notas média —/);
  assert.match(pagina(atual, [{}, anterior])[4]?.texto ?? "", /Nota humana 4,5 de 5 · 2 notas média 4,0 ▲ 13%/);
  assert.match(
    pagina({}, [{}])[0]?.texto ?? "",
    /Reprovações no Gate 0 de 0 Gates · 0 aprovações média 0 Gate da demanda/,
  );
});

test("por etapa: o Uso de cada Etapa com o custo, a média, a fonte e os modelos na escala do maior deles", () => {
  const modelo = (nome: string, custo: number | null, entrada: number, cache = 0) => ({
    modelo: nome,
    tokens_entrada: entrada,
    tokens_saida: 0,
    tokens_cache_leitura: cache,
    tokens_cache_escrita: 0,
    custo,
    chamadas: 0,
  });
  const externo = { conhecido: 0, trabalhosSemCusto: 0, sessoes: 5 };
  const anterior = mes("2026-09", 0, 0, null, {
    etapas: etapas({
      implementar: { uso: uso(10, 2) },
      planejar: { uso: uso(4, 1) },
      entender_e_desenhar: { uso: uso(2) },
    }),
  });
  const atual = mes("2026-10", 0, 0, null, {
    etapas: etapas({
      entender_e_desenhar: {
        uso: uso(4.2, 0, 9_800_000, {
          textoDoCusto: "≥ US$ 4,20 (2 sessões sem custo)",
          custoExterno: externo,
          modelos: [modelo("claude-bridge/claude-opus-5-5", 4.2, 100, 6_000_000), modelo("local", null, 50)],
        }),
      },
      implementar: {
        uso: uso(15, 3, 0, {
          falhas: 1,
          duracaoMs: 3 * 60_000 + 30_000,
          modelos: [
            modelo("openai-codex/gpt-6.1-sol", 0, 1_000_000),
            modelo("claude-bridge/claude-sonnet-5-5", 15, 2_000_000),
          ],
        }),
      },
      encerrar_demanda: { uso: uso(0, 3, 0, { duracaoMs: 126_000 }) },
    }),
  });
  const secoes = secoesDaPagina(paginaDeMetricas({ ...DADOS, meses: [anterior, atual] }, { ...ESTADO, de: "2026-09" }));
  const [entender, planejar, implementar] = [secoes[0], secoes[1], secoes[2]];
  // O custo com o aviso em destaque, a média dos meses anteriores e a variação.
  assert.match(
    entender?.html ?? "",
    /<span class="kpi-valor">≥ US\$ 4,20 <small class="sem-custo">\(2 sessões sem custo\)<\/small><\/span>/,
  );
  assert.match(
    entender?.texto ?? "",
    /Uso ≥ US\$ 4,20 \(2 sessões sem custo\) média US\$ 2,00 ▲ 110% 9,8 M tokens · 5 sessões declaradas pelo produtor /,
  );
  assert.match(
    implementar?.texto ?? "",
    /Uso US\$ 15,00 média US\$ 10,00 ▲ 50% 0 tokens · 3 execuções · 1 falha · 1 min 10 s por execução /,
  );
  assert.match(
    planejar?.texto ?? "",
    /Uso US\$ 0,00 média US\$ 4,00 ▼ 100% 0 tokens · 0 execuções · 0 falhas Nenhum modelo usado em out\/26\./,
  );
  assert.match(secoes[6]?.texto ?? "", /0 tokens · 3 execuções · 0 falhas · 42 s por execução/);
  // Os modelos: o nome, o provedor, o custo e os tokens, do mais caro ao mais barato; sem custo informado, "sem custo".
  assert.match(
    implementar?.texto ?? "",
    /claude-sonnet-5-5 claude-bridge US\$ 15,00 2,0 M gpt-6\.1-sol openai-codex US\$ 0,00 1,0 M/,
  );
  assert.match(entender?.texto ?? "", /claude-opus-5-5 claude-bridge US\$ 4,20 6,0 M local sem custo 50/);
  // A largura de cada trilha é relativa ao maior modelo de todas as Etapas do mês (6,0 M tokens).
  assert.match(entender?.html ?? "", /<div class="trilha" style="width:100.0%">/);
  assert.match(implementar?.html ?? "", /<div class="trilha" style="width:33.3%">/);
  assert.match(implementar?.html ?? "", /<div class="trilha" style="width:16.7%">/);
  // Sem execução e sem sessão declarada, a Etapa vazia não tem média nem aviso.
  assert.match(secoes[7]?.texto ?? "", /Uso US\$ 0,00 média US\$ 0,00 0 tokens/);
});

test("por nível: cada nível do agrupamento com a soma do mês, e o aviso quando há sessão sem custo", () => {
  const nivel = (n: Nivel, grupos: number, textoDoCusto: string) => ({
    nivel: n,
    grupos,
    total: { ...consumo(0, 100, 20, 30, 40, 5), textoDoCusto },
  });
  const textoComSessaoSemCusto = "≥ US$ 2,00 (1 sessão sem custo)";
  const niveis = [
    nivel("execucao", 5, "US$ 2,00"),
    nivel("sessao", 3, textoComSessaoSemCusto),
    nivel("ticket", 3, textoComSessaoSemCusto),
    nivel("rodada", 2, textoComSessaoSemCusto),
    nivel("demanda", 1, textoComSessaoSemCusto),
    nivel("projeto", 1, textoComSessaoSemCusto),
  ];
  const html = paginaDeMetricas(
    {
      ...DADOS,
      meses: [
        mes("2026-10", 2, 1, null, {
          niveis,
          total: { ...consumo(2), custo: { conhecido: 2, trabalhosSemCusto: 2 }, modelos: [] },
        }),
      ],
    },
    { ...ESTADO, de: "2026-10" },
  );
  const secao = /<h2>Por nível<\/h2>[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.equal(
    texto(secao),
    "Por nível out/26 execução → sessão → ticket → rodada → demanda → projeto: a soma de cada nível é o total do mês " +
      "Nível Grupos Execuções Tokens Custo Execução 5 5 190 US$ 2,00 " +
      `Sessão 3 5 190 ${textoComSessaoSemCusto} Ticket 3 5 190 ${textoComSessaoSemCusto} Rodada 2 5 190 ${textoComSessaoSemCusto} ` +
      `Demanda 1 5 190 ${textoComSessaoSemCusto} Projeto 1 5 190 ${textoComSessaoSemCusto} ` +
      "≥: 2 sessões sem custo informado; o custo delas fica fora da soma.",
  );
  const completo = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-10", 2, 1, null, { niveis })] },
    { ...ESTADO, de: "2026-10" },
  );
  assert.doesNotMatch(texto(/<h2>Por nível<\/h2>[\s\S]*?<\/section>/.exec(completo)?.[0] ?? ""), /≥:/);
  const uma = { ...consumo(2), custo: { conhecido: 2, trabalhosSemCusto: 1 }, modelos: [] };
  assert.match(
    texto(
      paginaDeMetricas(
        { ...DADOS, meses: [mes("2026-10", 2, 1, null, { niveis, total: uma })] },
        { ...ESTADO, de: "2026-10" },
      ),
    ),
    /≥: 1 sessão sem custo informado;/,
  );
});

test("por modelo: custo e tokens por tipo, do mais caro ao mais barato, custo desconhecido à parte e sem segmento vazio", () => {
  const uso = (modelo: string, provedor: string, custo: number | null, entrada = 0, saida = 0, cl = 0, ce = 0) => ({
    modelo: `${provedor}/${modelo}`,
    tokens_entrada: entrada,
    tokens_saida: saida,
    tokens_cache_leitura: cl,
    tokens_cache_escrita: ce,
    custo,
    chamadas: 0,
  });
  const modelos = [
    uso("qwen <3>", "llamacpp", 0, 100),
    uso("claude-opus-5-5", "anthropic", 9, 2_000_000, 400_000, 6_000_000, 300_000),
    uso("claude-haiku", "anthropic", 0, 200),
    uso("local", "llamacpp", null, 50),
    uso("local-2", "llamacpp", null, 40),
    { ...uso("", "", null, 30), modelo: "sem-provedor" },
  ];
  const html = paginaDeMetricas(
    { ...DADOS, meses: [mes("2026-10", 9, 0, null, { total: { ...consumo(9), modelos } })] },
    { ...ESTADO, de: "2026-10" },
  );
  const secao = /<h3>out\/26<\/h3><span class="sub">tokens por tipo[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.equal(
    texto(secao),
    "out/26 tokens por tipo e custo como o pi calculou cache entrada saída claude-opus-5-5 anthropic US$ 9,00 8,7 M claude-haiku anthropic US$ 0,00 200 qwen &#60;3&#62; llamacpp US$ 0,00 100 local llamacpp sem custo 50 local-2 llamacpp sem custo 40 sem-provedor sem custo 30",
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

test("por demanda: ordenável pelo cabeçalho, com link, projeto só em todos, estado, nota e o total", () => {
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
      estado: "gate_demanda",
      nota: 4,
      conformidade: 78,
      falhas: 1,
      reprovacoes: 2,
      textoDoCusto: "≥ US$ 1,00 (1 sessão sem custo)",
    }),
    demanda({ demanda: "I-7", titulo: "Cache", estado: "concluida" }),
  ];
  const totalDasDemandas = {
    ...consumo(7, 1000),
    textoDoCusto: "≥ US$ 7,00 (1 sessão sem custo)",
    conformidade: 79,
    nota: 4.25,
  };
  const ids = (e: Partial<EstadoDasMetricas>) =>
    [
      ...paginaDeMetricas({ ...DADOS, demandas, totalDasDemandas }, { ...ESTADO, ...e }).matchAll(
        /class="id" href="[^"]+">(I-\d+)</g,
      ),
    ].map((m) => m[1]);
  assert.deepEqual(ids({}), ["I-3", "I-12", "I-7"]);
  assert.deepEqual(ids({ ordem: ["demanda", 1] }), ["I-3", "I-7", "I-12"]);
  assert.deepEqual(ids({ ordem: ["titulo", 1] }), ["I-3", "I-7", "I-12"]);
  assert.deepEqual(ids({ ordem: ["projeto", -1] }), ["I-12", "I-3", "I-7"]);
  assert.deepEqual(ids({ ordem: ["estado", 1] }), ["I-12", "I-7", "I-3"]);
  assert.deepEqual(ids({ ordem: ["tokens", -1] }), ["I-3", "I-12", "I-7"]);
  assert.deepEqual(ids({ ordem: ["duracao", -1] }), ["I-3", "I-12", "I-7"]);
  assert.deepEqual(ids({ ordem: ["nota", 1] }), ["I-3", "I-7", "I-12"]);
  assert.deepEqual(ids({ ordem: ["falhas", -1] }), ["I-12", "I-3", "I-7"]);
  assert.deepEqual(ids({ ordem: ["conformidade", -1] }), ["I-12", "I-3", "I-7"]);

  const html = paginaDeMetricas({ ...DADOS, demandas, totalDasDemandas }, ESTADO);
  assert.match(
    html,
    /<th class="num ordenavel" aria-sort="descending"><button type="button" data-ordem="custo">Custo<\/button><\/th>/,
  );
  assert.match(
    html,
    /<a class="id" href="\/demandas\/I-12">I-12<\/a><\/td>\s*<td>Demanda I-12<\/td>\s*<td class="muted">site<\/td>\s*<td><span class="pill pill-aguarda">Aprovação da demanda<\/span>/,
  );
  assert.match(html, /<td class="num">≥ US\$ 1,00 \(1 sessão sem custo\)<\/td>/);
  assert.match(html, /<td class="num">0,78<\/td><td class="num">4,0<\/td>/);
  assert.match(html, /<td class="num">—<\/td><td class="num">—<\/td><\/tr>/);
  assert.match(html, /data-ordem="conformidade">Conformidade<\/button>[\s\S]*data-ordem="nota">Nota humana<\/button>/);
  assert.match(html, /Busca &#60;b&#62;/);
  assert.match(html, /<span class="pill pill-ok">Concluída<\/span>/);
  assert.doesNotMatch(html, /Iterações/);
  assert.equal(
    texto(/<tfoot>(?:(?!<tfoot>)[\s\S])*?<\/tfoot>(?![\s\S]*<tfoot>)/.exec(html)?.[0] ?? ""),
    "3 demandas ≥ US$ 7,00 (1 sessão sem custo) 1,0 mil 6 1 2 1 h 2 min 0,79 4,3",
  );
  assert.match(
    html,
    /a out\/26 · todos os projetos · clique no cabeçalho para ordenar · ≥ há sessão sem custo informado · conformidade: Jaccard do plano × arquivos alterados · nota: média do Gate do PR/,
  );

  const loja = paginaDeMetricas(
    { ...DADOS, demandas, totalDasDemandas },
    { ...ESTADO, projeto: "loja", ordem: ["custo", 1] },
  );
  assert.doesNotMatch(loja, /data-ordem="projeto"/);
  assert.match(loja, /aria-sort="ascending"/);
  assert.match(loja, /<td colspan="3">3 demandas/);
  assert.match(loja, /· loja · clique/);
  assert.match(paginaDeMetricas(DADOS, ESTADO), /Nenhuma demanda com execução no período./);
});

test("próxima ordem: a mesma coluna inverte; outra começa crescente no texto, na demanda e no estado", () => {
  assert.deepEqual(proximaOrdem(["custo", -1], "custo"), ["custo", 1]);
  assert.deepEqual(proximaOrdem(["custo", 1], "custo"), ["custo", -1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "titulo"), ["titulo", 1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "demanda"), ["demanda", 1]);
  assert.deepEqual(proximaOrdem(["custo", -1], "estado"), ["estado", 1]);
  assert.deepEqual(proximaOrdem(["titulo", 1], "execucoes"), ["execucoes", -1]);
});

test("Projeto: os 6 cards do mês corrente", () => {
  const m = mes("2026-10", 38.42, 7, null, {
    total: { ...consumo(38.42, 2_200_000, 400_000, 6_000_000, 300_000, 902), modelos: [] },
  });
  assert.equal(
    texto(cardsDoMes(m)),
    "Custo · outubro US$ 38,42 902 execuções Tokens 8,9 M 2,2 M entrada · 400,0 mil saída · 6,0 M cache lido · 300,0 mil cache escrito Demandas 8 / 7 registradas / concluídas Tickets 9 / 7 criados / concluídos PRs 8 / 7 abertos / mergeados Alterações posteriores 7 / 100 linhas alteradas / adicionadas",
  );
  assert.match(
    cardsDoMes(mes("2026-01", 0, 0, null, { total: { ...consumo(0, 0, 0, 0, 0, 1), modelos: [] } })),
    /1 execução</,
  );
  const parcial = { ...m, total: { ...m.total, textoDoCusto: "≥ US$ 1,00 (1 sessão sem custo)" } };
  assert.match(texto(cardsDoMes(parcial)), /Custo · outubro ≥ US\$ 1,00 \(1 sessão sem custo\)/);
});

test("Início: a frase do mês corrente de todos os projetos, com o link para as Métricas", () => {
  const m = mes("2026-10", 1302.24, 102, null, {
    total: { ...consumo(1302.24, 2_000_000_000, 4_500_000, 300_000_000, 0, 9), modelos: [] },
  });
  assert.equal(
    texto(fraseDoMes(m)),
    "Outubro de 2026, todos os projetos: US$ 1.302,24 · 2.304,5 M tokens · demandas 103 registradas, 102 concluídas · tickets 104 criados, 102 concluídos · PRs 103 abertos, 102 mergeados Métricas →",
  );
  assert.match(fraseDoMes(m), /<a href="\/metrics">Métricas →<\/a><\/p>$/);
  // Os números com o separador de milhar, como nas Métricas.
  const grande = mes("2026-10", 1, 0, null, {
    demandas: { registradas: 2_470, concluidas: 1_050 },
    tickets: { criados: 1_428, concluidos: 1_255 },
    prs: { abertos: 1_110, mergeados: 1_070 },
  });
  assert.match(
    texto(fraseDoMes(grande)),
    /demandas 2\.470 registradas, 1\.050 concluídas · tickets 1\.428 criados, 1\.255 concluídos · PRs 1\.110 abertos, 1\.070 mergeados/,
  );
});

test("milhares: as contagens das tabelas e dos cards do Projeto com o separador de milhar", () => {
  const grande = { ...consumo(1, 0, 0, 0, 0, 24_929), falhas: 1_234 };
  const m = mes("2026-10", 1, 24_929, null, {
    niveis: [{ nivel: "execucao", grupos: 12_345, total: grande }],
    etapas: etapas({ implementar: { alteracoes_posteriores: { adicionadas: 289_424, alteradasPorHumanos: 24_929 } } }),
  });
  const html = texto(
    paginaDeMetricas(
      {
        ...DADOS,
        meses: [m],
        demandas: [demanda({ demanda: "I-1", ...grande, reprovacoes: 5_678 })],
        totalDasDemandas: { ...grande, conformidade: null, nota: null },
      },
      { ...ESTADO, de: "2026-10" },
    ),
  );
  // Por nível: grupos e execuções.
  assert.match(html, /Execução 12\.345 24\.929 /);
  // Por demanda: a linha e o total.
  assert.match(html, /I-1 Demanda I-1 .* 24\.929 1\.234 5\.678 .* 1 demanda .* 24\.929 1\.234 5\.678 /);
  assert.match(
    texto(cardsDoMes(m)),
    /Demandas 24\.930 \/ 24\.929 .* Tickets 24\.931 \/ 24\.929 .* PRs 24\.930 \/ 24\.929 .* Alterações posteriores 24\.929 \/ 289\.424 /,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricasMesDemanda } from "../../../metricas/periodo_demanda.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { abas, caminhoDoProjeto, escolherProjeto, paginaDoProjeto, projetoNaoEncontrado } from "./projeto.ts";

const projeto = (nome: string): ProjetoListado => ({
  nome,
  repo: `/repos/${nome}`,
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  testes: [],
  sonar: { projectKey: nome },
  fitness: [],
  modelos: {},
});
const PROJETOS = [projeto("fabriquinha"), projeto("loja <api>")];

/** O mês corrente de `GET /api/metricas`, para os cards do Projeto. */
const MES: MetricasMesDemanda = {
  mes: "2026-10",
  projeto: null,
  total: {
    execucoes: 3,
    falhas: 0,
    duracaoMs: 0,
    tokens: { entrada: 1200, saida: 300, cacheLeitura: 0, cacheEscrita: 0 },
    custo: { conhecido: 1.5, incompleto: false },
    modelos: [],
  },
  niveis: [],
  demandas: { registradas: 2, concluidas: 1 },
  tickets: { criados: 4, concluidos: 3 },
  prs: { abertos: 1, mergeados: 0 },
  nota: { media: null, notas: 0 },
  retrabalho: { adicionadas: 40, alteradas: 10, porHumanos: 2 },
  etapas: [],
};

test("/projects escolhe o último projeto visto, se ainda existe, ou o primeiro em ordem alfabética", () => {
  assert.equal(escolherProjeto(PROJETOS, "loja <api>"), "loja <api>");
  assert.equal(escolherProjeto(PROJETOS, "apagado"), "fabriquinha");
  assert.equal(escolherProjeto(PROJETOS), "fabriquinha");
  assert.equal(escolherProjeto([], "loja"), undefined);
  assert.equal(caminhoDoProjeto("loja <api>"), "/projects/loja%20%3Capi%3E");
  assert.match(projetoNaoEncontrado("<x>"), /O projeto &#60;x&#62; não está cadastrado/);
});

test("as abas são links, com a ativa marcada, e a página do projeto abre com Visão geral ativa", () => {
  assert.equal(
    abas("loja <api>", "heatmap"),
    '<nav class="abas" aria-label="Abas do projeto"><a href="/projects/loja%20%3Capi%3E">Visão geral</a><a href="/projects/loja%20%3Capi%3E/heatmap" aria-current="page">Heatmap</a></nav>',
  );
  const html = paginaDoProjeto(PROJETOS, "loja <api>", MES);
  assert.ok(html.indexOf("data-projeto") < html.indexOf('class="abas"'));
  assert.match(html, /<a href="\/projects\/loja%20%3Capi%3E" aria-current="page">Visão geral<\/a>/);
});

test("CA-5: o seletor, Editar na Configuração e os cards do mês; sem Registrar necessidade nem lista de issues", () => {
  const html = paginaDoProjeto(PROJETOS, "loja <api>", MES);
  assert.match(html, /<option>fabriquinha<\/option><option selected>loja &#60;api&#62;<\/option>/);
  assert.match(html, /<a class="editar" href="\/config\?projeto=loja%20%3Capi%3E">Editar na Configuração<\/a>/);
  assert.match(
    html,
    /<\/nav><div class="kpis-mes">\s*<div class="kpi superficie"><span class="rotulo">Custo · outubro<\/span><span class="kpi-valor">US\$ 1,50<\/span><span class="kpi-sub">3 execuções/,
  );
  assert.doesNotMatch(html, /Registrar necessidade|[Ii]ssue|Arquivar|pista/);
});

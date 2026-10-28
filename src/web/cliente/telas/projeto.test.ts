import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricasMesDemanda } from "../../../metricas/periodo_demanda.ts";
import type { DemandaDoProjeto, ListaDoProjeto } from "../../rotas/projeto.ts";
import type { ProjetoListado } from "./configuracao.ts";
import {
  abas,
  caminhoDoProjeto,
  confirmacaoDeArquivar,
  type Escolhas,
  escolherProjeto,
  estadoDaDemanda,
  faseNaLinhaDoTempo,
  ha,
  paginaDoProjeto,
  projetoNaoEncontrado,
  situacaoNaDemanda,
  situacaoNaRodada,
} from "./projeto.ts";

const projeto = (nome: string): ProjetoListado => ({
  nome,
  repo: `/repos/${nome}`,
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  sonar: { projectKey: nome },
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

const AGORA = new Date("2026-10-28T12:00:00.000Z");
const SEM_ESCOLHAS: Escolhas = {
  mostrar: { concluidas: false, arquivadas: false, canceladas: false },
  gavetas: new Map(),
};
const VAZIA: ListaDoProjeto = {
  demandas: [],
  contagem: { andamento: 0, concluidas: 0, arquivadas: 0, canceladas: 0 },
};

type Ticket = DemandaDoProjeto["tickets"][number];
const ticket = (
  ref: string,
  etapa: Ticket["etapa"],
  status: Ticket["status"],
  resto: Partial<Ticket> = {},
): Ticket => ({
  ref,
  etapa,
  status,
  statusAlteradoEm: "2026-10-28T11:55:00.000Z",
  ...resto,
});
const demanda = (id: string, fase: DemandaDoProjeto["fase"], resto: Partial<DemandaDoProjeto> = {}) =>
  ({
    id,
    titulo: `Demanda ${id}`,
    tipo: "funcionalidade",
    fase,
    faseAlteradaEm: "2026-10-03T12:00:00",
    bloqueadaPor: [],
    rodadas: [],
    tickets: [],
    ...resto,
  }) satisfies DemandaDoProjeto;

/** A página com só as demandas `demandas`, para olhar as linhas. */
const pagina = (demandas: DemandaDoProjeto[], escolhas = SEM_ESCOLHAS): string =>
  paginaDoProjeto(PROJETOS, "loja <api>", { ...VAZIA, demandas }, MES, escolhas, AGORA);

/** O HTML da linha da demanda `id` (até a próxima linha). */
function linhaDe(html: string, id: string): string {
  const inicio = html.indexOf(`data-demanda="${id}"`);
  assert.ok(inicio >= 0, `sem a linha da ${id}`);
  const fim = html.indexOf('<div class="pista-item', inicio);
  return html.slice(inicio, fim < 0 ? undefined : fim);
}

/** Só as situações das colunas, na ordem. */
const situacoes = (colunas: ReturnType<typeof situacaoNaDemanda>): string[] => colunas.map(([, situacao]) => situacao);

/** As classes dos 11 passos de uma linha do tempo (`ol`), na ordem. */
const passos = (ol: string): string[] => [...ol.matchAll(/<li class="([^"]*)"/g)].map((m) => String(m[1]));

test("/projects escolhe o último projeto visto, se ainda existe, ou o primeiro em ordem alfabética", () => {
  assert.equal(escolherProjeto(PROJETOS, "loja <api>"), "loja <api>");
  assert.equal(escolherProjeto(PROJETOS, "apagado"), "fabriquinha");
  assert.equal(escolherProjeto(PROJETOS), "fabriquinha");
  assert.equal(escolherProjeto([], "loja"), undefined);
  assert.equal(caminhoDoProjeto("loja <api>"), "/projects/loja%20%3Capi%3E");
  assert.match(projetoNaoEncontrado("<x>"), /O projeto &#60;x&#62; não está cadastrado/);
});

test("as abas são links, com a ativa marcada, e a página do projeto abre com Demandas ativa", () => {
  assert.equal(
    abas("loja <api>", "heatmap"),
    '<nav class="abas" aria-label="Abas do projeto"><a href="/projects/loja%20%3Capi%3E">Demandas</a><a href="/projects/loja%20%3Capi%3E/heatmap" aria-current="page">Heatmap</a></nav>',
  );
  const html = pagina([]);
  assert.ok(html.indexOf("data-projeto") < html.indexOf('class="abas"'));
  assert.match(html, /<a href="\/projects\/loja%20%3Capi%3E" aria-current="page">Demandas<\/a>/);
});

test("o seletor, Editar na Configuração e os cards do mês em cima; sem Registrar necessidade", () => {
  const html = pagina([]);
  assert.match(html, /<option>fabriquinha<\/option><option selected>loja &#60;api&#62;<\/option>/);
  assert.match(html, /<a class="editar" href="\/config\?projeto=loja%20%3Capi%3E">Editar na Configuração<\/a>/);
  assert.match(
    html,
    /<\/nav><div class="kpis-mes">\s*<div class="kpi superficie"><span class="rotulo">Custo · outubro<\/span><span class="kpi-valor">US\$ 1,50<\/span><span class="kpi-sub">3 execuções/,
  );
  assert.ok(html.indexOf("kpis-mes") < html.indexOf('class="ferramentas"'));
  assert.doesNotMatch(html, /Registrar necessidade/);
});

test("a contagem, os filtros marcados como escolhidos e o Arquivar concluídas só com concluídas", () => {
  const vazia = pagina([]);
  assert.match(vazia, /0 em andamento · 0 concluídas · 0 arquivadas · 0 canceladas/);
  assert.match(vazia, /data-arquivar disabled>Arquivar concluídas/);
  assert.match(vazia, /<p class="vazio">Nenhuma demanda\.<\/p>/);
  assert.doesNotMatch(vazia, /checked/);
  const html = paginaDoProjeto(
    PROJETOS,
    "loja",
    { demandas: [], contagem: { andamento: 1, concluidas: 1, arquivadas: 2, canceladas: 3 } },
    MES,
    { ...SEM_ESCOLHAS, mostrar: { concluidas: true, arquivadas: false, canceladas: true } },
    AGORA,
  );
  assert.match(html, /1 em andamento · 1 concluída · 2 arquivadas · 3 canceladas/);
  assert.match(html, /<input type="checkbox" data-mostrar="concluidas" checked> Mostrar concluídas/);
  assert.match(html, /<input type="checkbox" data-mostrar="arquivadas"> Mostrar arquivadas/);
  assert.match(html, /<input type="checkbox" data-mostrar="canceladas" checked> Mostrar canceladas/);
  assert.match(html, /data-arquivar>Arquivar concluídas/);
});

test("a confirmação do Arquivar concluídas diz quantas e que nada é apagado", () => {
  assert.match(confirmacaoDeArquivar(1, "<l>"), /1 demanda concluída de &#60;l&#62; será arquivada\. Ela sai/);
  assert.match(
    confirmacaoDeArquivar(2, "loja"),
    /2 demandas concluídas de loja serão arquivadas\. Elas saem desta lista e continuam acessíveis em "Mostrar arquivadas"\. Nada é apagado\./,
  );
});

test("o cabeçalho tem as 5 etapas sobre as 11 fases, com Implementar sobre as 5 da rodada e os gates em âmbar", () => {
  const html = pagina([demanda("I-1", "registro")]);
  assert.deepEqual(
    [...html.matchAll(/<div class="pista-etapa" style="grid-column: span (\d+)">(\w+)<\/div>/g)].map((m) => [
      m[2],
      m[1],
    ]),
    [
      ["Registrar", "2"],
      ["Planejar", "2"],
      ["Implementar", "5"],
      ["Revisar", "1"],
      ["Encerrar", "1"],
    ],
  );
  assert.deepEqual(
    [...html.matchAll(/<div class="pista-fase gate">([^<]+)<\/div>/g)].map((m) => m[1]),
    ["Aprovação da demanda", "Aprovação do planejamento", "Aprovação do PR"],
  );
  assert.equal([...html.matchAll(/<div class="pista-fase( gate)?">/g)].length, 11);
});

test("na linha da demanda, as fases passadas feitas, a atual marcada, e na execução o trecho das rodadas", () => {
  const F = "feito";
  assert.deepEqual(situacoes(situacaoNaDemanda("registro", false)), ["atual", "", "", "", "", "", "", "", "", "", ""]);
  assert.deepEqual(situacoes(situacaoNaDemanda("aprovacao_planejamento", false)), [
    F,
    F,
    F,
    "atual",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  const rodadas = Array<string>(5).fill("rodadas");
  assert.deepEqual(situacoes(situacaoNaDemanda("execucao", false)), [F, F, F, F, ...rodadas, "", ""]);
  // Depois da execução, Ajustes do PR só fica verde se alguma rodada passou por ele; senão a linha passa por ele.
  assert.deepEqual(situacoes(situacaoNaDemanda("revisao_demanda", false)), [
    F,
    F,
    F,
    F,
    F,
    F,
    F,
    F,
    "pulada",
    "atual",
    "",
  ]);
  assert.deepEqual(situacoes(situacaoNaDemanda("concluida", true)), Array<string>(11).fill(F));
});

test("na linha da rodada, só o trecho das rodadas; Ajustes do PR verde se ela passou por ele, pulado se não", () => {
  const fora = Array<string>(4).fill("fora");
  assert.deepEqual(situacoes(situacaoNaRodada("desenvolvimento", false)), [
    ...fora,
    "atual",
    "",
    "",
    "",
    "",
    "fora",
    "fora",
  ]);
  assert.deepEqual(situacoes(situacaoNaRodada("sessao", false)), [
    ...fora,
    "feito",
    "feito",
    "feito",
    "feito",
    "atual",
    "fora",
    "fora",
  ]);
  assert.deepEqual(situacoes(situacaoNaRodada("concluida", false)), [
    ...fora,
    "feito",
    "feito",
    "feito",
    "feito",
    "pulada",
    "fora",
    "fora",
  ]);
  assert.deepEqual(situacoes(situacaoNaRodada("concluida", true)), [
    ...fora,
    "feito",
    "feito",
    "feito",
    "feito",
    "feito",
    "fora",
    "fora",
  ]);
});

test("a cancelada marca a etapa mais adiantada dos tickets; a arquivada, tudo feito", () => {
  assert.equal(faseNaLinhaDoTempo({ fase: "cancelada", tickets: [] }), "registro");
  const tickets = [
    ticket("I-1.T3", "implementar", "cancelado"),
    ticket("I-1.T1", "demanda", "concluido"),
    ticket("I-1.T2", "planejar", "concluido"),
  ];
  assert.equal(faseNaLinhaDoTempo({ fase: "cancelada", tickets }), "execucao");
  assert.equal(faseNaLinhaDoTempo({ fase: "arquivada", tickets }), "concluida");
  assert.equal(faseNaLinhaDoTempo({ fase: "planejamento", tickets }), "planejamento");
});

test("o estado da demanda: a falha antes do gate, o gate antes do que roda; encerrada sem cor", () => {
  const rodando = [ticket("I-1.T1", "planejar", "em_execucao")];
  assert.equal(estadoDaDemanda(demanda("I-1", "cancelada", { tickets: rodando })), "cancelada");
  assert.equal(estadoDaDemanda(demanda("I-1", "concluida")), undefined);
  assert.equal(estadoDaDemanda(demanda("I-1", "arquivada")), undefined);
  assert.equal(
    estadoDaDemanda(demanda("I-1", "aprovacao_demanda", { tickets: [ticket("I-1.T1", "demanda", "falhou")] })),
    "falha",
  );
  assert.equal(estadoDaDemanda(demanda("I-1", "aprovacao_demanda", { tickets: rodando })), "aguarda");
  assert.equal(estadoDaDemanda(demanda("I-1", "aprovacao_planejamento")), "aguarda");
  const rodada = (fase: DemandaDoProjeto["rodadas"][number]["fase"]) => ({ ref: "I-1.R1", titulo: "r", fase });
  assert.equal(estadoDaDemanda(demanda("I-1", "execucao", { rodadas: [rodada("sessao")] })), "aguarda");
  assert.equal(
    estadoDaDemanda(demanda("I-1", "execucao", { rodadas: [rodada("revisao")], tickets: rodando })),
    "rodando",
  );
  assert.equal(estadoDaDemanda(demanda("I-1", "planejamento")), undefined);
});

test("a linha da demanda: título com link, I-n, tipo, bloqueio, progresso e a linha do tempo com a cor do estado", () => {
  const html = pagina([
    demanda("I-7", "planejamento", {
      titulo: "Busca <rápida>",
      tipo: "problema",
      bloqueadaPor: ["I-5", "I-6"],
      tickets: [ticket("I-7.T1", "demanda", "concluido"), ticket("I-7.T2", "planejar", "em_execucao")],
    }),
  ]);
  const linha = linhaDe(html, "I-7");
  assert.match(linha, /^data-demanda="I-7">/);
  assert.match(linha, /<a class="titulo" href="\/demandas\/I-7">Busca &#60;rápida&#62;<\/a>/);
  assert.match(
    linha,
    /<span class="id">I-7<\/span><span class="tag">problema<\/span><span class="bloqueia">bloqueada por I-5, I-6<\/span><span class="progresso" title="tickets concluídos">1\/2<span class="trilho-p"><i style="width:50%"><\/i><\/span><\/span><\/span>/,
  );
  assert.match(linha, /<ol class="trilho-fases rodando" aria-label="Fases da demanda I-7">/);
  assert.match(
    linha,
    /<li class="passo atual" aria-current="step"><span class="linha"><span class="marco"><\/span><\/span><span>Planejamento<\/span><\/li>/,
  );
  assert.match(linha, /<li class="passo gate feito">/);
  // Sem rodadas fora da execução; rodando, a gaveta começa fechada e o destaque leva ao chat de quem roda.
  assert.doesNotMatch(linha, /pista-rodada/);
  assert.match(html, /class="pista-item rodando fechada"/);
  assert.match(
    linha,
    /<div class="pista-estado"><span class="chat"><span class="pill pill-rodando">Rodando<\/span><span class="muted quando">há 5\u00a0min<\/span><\/span><\/div>/,
  );
});

test("na execução, uma sub-linha por rodada com o endereço, o título, o PR e a linha do tempo dela", () => {
  const html = pagina([
    demanda("I-9", "execucao", {
      rodadas: [
        { ref: "I-9.R1", titulo: "Base <a>", fase: "concluida", pr: { id: "7", url: "https://pr/7" } },
        { ref: "I-9.R2", titulo: "Tela", fase: "aprovacao_pull_request", pr: { id: "8", url: "javascript:x" } },
        { ref: "I-9.R3", titulo: "Ajustes", fase: "desenvolvimento" },
        { ref: "I-9.R4", titulo: "Erros", fase: "revisao" },
      ],
      tickets: [
        ticket("I-9.T1", "sessao_em_aberto", "concluido", { rodada: "I-9.R1" }),
        ticket("I-9.T2", "implementar", "em_execucao", { rodada: "I-9.R3" }),
        ticket("I-9.T3", "implementar", "concluido", { rodada: "I-9.R4" }),
      ],
    }),
  ]);
  const linha = linhaDe(html, "I-9");
  const rodadas = linha.split('<div class="pista-rodada">').slice(1);
  assert.equal(rodadas.length, 4);
  assert.match(
    rodadas[0] ?? "",
    /<span class="id">I-9\.R1<\/span><span class="rodada-titulo" title="Base &#60;a&#62;">Base &#60;a&#62;<\/span><a class="pr" href="https:\/\/pr\/7" target="_blank" rel="noopener">PR #7<\/a>/,
  );
  // O PR com endereço que não é http(s) vira texto; a rodada sem PR não tem marca.
  assert.match(rodadas[1] ?? "", /<span class="pr">PR #8<\/span>/);
  assert.doesNotMatch(rodadas[2] ?? "", /PR #/);
  assert.deepEqual(passos(rodadas[0] ?? "").slice(4, 9), [
    "passo feito",
    "passo feito",
    "passo feito",
    "passo gate feito",
    "passo feito",
  ]);
  assert.match(rodadas[0] ?? "", /<ol class="trilho-fases" aria-label="Fases da rodada I-9\.R1">/);
  assert.match(rodadas[1] ?? "", /<ol class="trilho-fases aguarda"/);
  assert.match(rodadas[2] ?? "", /<ol class="trilho-fases rodando"/);
  assert.match(rodadas[3] ?? "", /<ol class="trilho-fases" /);
  // A linha da demanda leva o trecho das rodadas, sem marco; aguarda o PR, a gaveta começa aberta.
  assert.deepEqual(passos(linha.slice(0, linha.indexOf("pista-rodada"))).slice(4, 9), [
    "passo rodadas",
    "passo rodadas",
    "passo rodadas",
    "passo gate rodadas",
    "passo rodadas",
  ]);
  assert.match(html, /class="pista-item aguarda"/);
  assert.match(
    linha,
    /<div class="pista-estado"><a class="chat" href="\/demandas\/I-9"><span class="pill pill-aguarda">Aguarda você<\/span><span class="ir">abrir →<\/span><\/a><\/div>/,
  );
});

test("a falha: borda vermelha, gaveta aberta, a rodada falha e o destaque com o chat do ticket", () => {
  const html = pagina([
    demanda("I-3", "execucao", {
      rodadas: [{ ref: "I-3.R1", titulo: "r", fase: "desenvolvimento" }],
      tickets: [ticket("I-3.T1", "implementar", "falhou", { rodada: "I-3.R1", sessao: "s/1" })],
    }),
  ]);
  assert.match(html, /class="pista-item falha"/);
  assert.match(html, /aria-expanded="true" aria-label="Tickets de I-3"/);
  assert.match(html, /<div class="pista-rodada">[\s\S]*<ol class="trilho-fases falha"/);
  assert.match(
    html,
    /<a class="chat" href="\/sessions\/s%2F1"><span class="pill pill-falha">Falhou<\/span><span class="muted quando">há 5\u00a0min<\/span><span class="ir">chat →<\/span><\/a>/,
  );
});

test("a gaveta: etapa, endereço, título, status, modelo e o chat; a escolha do Auditor vale sobre o padrão", () => {
  const html = pagina(
    [
      demanda("I-4", "execucao", {
        tickets: [
          ticket("I-4.T1", "demanda", "concluido"),
          ticket("I-4.T2", "implementar", "aberto", {
            titulo: "Cache <x>",
            modelo: "anthropic / claude",
            sessao: "s1",
          }),
          ticket("I-4.T3", "sessao_em_aberto", "fechado", { sessao: "s2" }),
          ticket("I-4.T4", "revisar_rodada", "cancelado"),
        ],
      }),
      demanda("I-5", "aprovacao_demanda"),
    ],
    {
      ...SEM_ESCOLHAS,
      gavetas: new Map([
        ["I-4", true],
        ["I-5", false],
      ]),
    },
  );
  const linhas = [...linhaDe(html, "I-4").matchAll(/<tr( class="apagada")?>([\s\S]*?)<\/tr>/g)];
  assert.deepEqual(
    linhas.map((l) => Boolean(l[1])),
    [true, false, true, true],
  );
  const celulas = (n: number) =>
    [...String(linhas[n]?.[2]).matchAll(/<td class="([\w-]+)">([\s\S]*?)<\/td>/g)].map((c) => [c[1], c[2]]);
  assert.deepEqual(celulas(0), [
    ["etapa-cel", "demanda"],
    ["id-cel", '<span class="id">I-4.T1</span>'],
    ["titulo-cel", "Registrar a demanda"],
    ["status-cel", '<span class="pill pill-ok">concluído</span>'],
    ["modelo-cel", '<span class="modelo" title="padrão do pi">padrão do pi</span>'],
    ["sessao-cel", ""],
  ]);
  assert.deepEqual(celulas(1).slice(2), [
    ["titulo-cel", "Cache &#60;x&#62;"],
    ["status-cel", '<span class="pill pill-neutro">aberto</span>'],
    ["modelo-cel", '<span class="modelo" title="anthropic / claude">anthropic / claude</span>'],
    ["sessao-cel", '<a class="chat" href="/sessions/s1"><span class="ir">chat →</span></a>'],
  ]);
  // A sessão de ajustes conversa na página da demanda: sem o chat.
  assert.deepEqual(celulas(2)[0], ["etapa-cel", "sessão em aberto"]);
  assert.deepEqual(celulas(2)[5], ["sessao-cel", ""]);
  // I-4 sem estado abre porque o Auditor abriu; I-5 no gate fecha porque ele fechou.
  assert.match(html, /aria-expanded="true" aria-label="Tickets de I-4"/);
  assert.match(html, /class="pista-item aguarda fechada"/);
  assert.match(linhaDe(html, "I-5"), /<p class="muted">Nenhum ticket ainda\.<\/p>/);
  assert.match(linhaDe(html, "I-5"), /0\/0<span class="trilho-p"><i style="width:0%">/);
});

test("as encerradas apagadas, com quando saíram do andamento; a cancelada marca onde parou, sem cor", () => {
  const html = pagina([
    demanda("I-1", "concluida"),
    demanda("I-2", "arquivada"),
    demanda("I-3", "cancelada", {
      rodadas: [{ ref: "I-3.R1", titulo: "r", fase: "revisao" }],
      tickets: [ticket("I-3.T1", "implementar", "em_execucao", { rodada: "I-3.R1" })],
    }),
  ]);
  assert.match(linhaDe(html, "I-1"), /<span>concluída em 03\/10<\/span>/);
  assert.match(linhaDe(html, "I-2"), /<span>arquivada em 03\/10<\/span>/);
  assert.match(linhaDe(html, "I-3"), /<span class="cancelada">cancelada em 03\/10<\/span>/);
  assert.match(html, /class="pista-item fechada apagada" data-demanda="I-1"/);
  assert.match(html, /class="pista-item cancelada fechada apagada" data-demanda="I-3"/);
  assert.deepEqual(passos(linhaDe(html, "I-1")), [
    "passo feito",
    "passo gate feito",
    "passo feito",
    "passo gate feito",
    "passo feito",
    "passo feito",
    "passo feito",
    "passo gate feito",
    "passo pulada",
    "passo feito",
    "passo feito",
  ]);
  // A cancelada na execução mostra as rodadas onde pararam, apagadas, e nenhum destaque.
  assert.match(linhaDe(html, "I-3"), /<div class="pista-rodada">[\s\S]*<ol class="trilho-fases cancelada"/);
  assert.match(linhaDe(html, "I-3"), /<div class="pista-estado"><\/div>/);
});

test("há quanto tempo: menos de 1 min, minutos, e horas com minutos, sem quebrar", () => {
  assert.equal(ha("2026-10-28T11:59:30.000Z", AGORA), "há menos\u00a0de\u00a01\u00a0min");
  assert.equal(ha("2026-10-28T11:15:00.000Z", AGORA), "há 45\u00a0min");
  assert.equal(ha("2026-10-28T09:50:00.000Z", AGORA), "há 2\u00a0h\u00a010\u00a0min");
});

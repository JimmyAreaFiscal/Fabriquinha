import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetricasMesDemanda } from "../../../metricas/periodo_demanda.ts";
import type { CartaoDoBoard, DadosDoInicio, EsperaDoAuditor, SessaoRodando } from "../../rotas/inicio.ts";
import { inicio } from "./inicio.ts";

const agora = new Date("2026-10-28T12:00:00.000Z");
const mes = {
  mes: "2026-10",
  projeto: null,
  total: {
    execucoes: 1,
    falhas: 0,
    duracaoMs: 0,
    tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
    custo: { conhecido: 0, incompleto: false },
    modelos: [],
  },
  demandas: { registradas: 0, concluidas: 0 },
  tickets: { criados: 0, concluidos: 0 },
  prs: { abertos: 0, mergeados: 0 },
} as unknown as MetricasMesDemanda;

const dados = (resto: Partial<DadosDoInicio> = {}): DadosDoInicio => ({
  mes,
  aguarda: [],
  rodando: [],
  emAndamento: 0,
  board: [],
  ...resto,
});

const espera = (motivo: EsperaDoAuditor["motivo"], resto: Partial<EsperaDoAuditor> = {}): EsperaDoAuditor => ({
  motivo,
  demanda: "I-206",
  projeto: "loja",
  titulo: "Busca <rápida>",
  desde: "2026-10-28T11:15:00.000Z",
  ...resto,
});

const sessao = (resto: Partial<SessaoRodando> = {}): SessaoRodando => ({
  sessao: "s1",
  projeto: "loja",
  demanda: "I-206",
  titulo: "Busca",
  rodada: "I-206.R2",
  ticket: "I-206.T3",
  etapa: "implementar",
  modo: "autonomo",
  estado: "rodando",
  desde: "2026-10-28T11:59:30.000Z",
  inicio: "2026-10-28T11:00:00.000Z",
  resultado: "concluida",
  ...resto,
});

const cartao = (resto: Partial<CartaoDoBoard> = {}): CartaoDoBoard => ({
  coluna: "desenvolvimento",
  ref: "I-206.R2",
  demanda: "I-206",
  projeto: "loja",
  titulo: "Busca",
  outros: 0,
  bloqueios: [],
  ...resto,
});

/** O HTML de uma coluna do board, pelo nome dela. */
const coluna = (html: string, nome: string): string =>
  html.split(/<div class="coluna(?: coluna-gate)?">/).find((c) => c.includes(`coluna-cabeca">${nome} <`)) ?? "";

test("sem nada em andamento: a frase do mês, nada aguarda, nada roda e as 11 colunas vazias sob as 5 etapas", () => {
  const html = inicio(dados(), agora);
  assert.match(html, /<h1>Início<\/h1>/);
  assert.doesNotMatch(html, /Registrar necessidade/);
  assert.match(html, /<p class="frase-mes">Outubro de 2026, todos os projetos:/);
  assert.match(html, /Aguarda você<\/h2><\/div>\s*<p class="muted vazio">Nada aguarda você agora\.<\/p>/);
  assert.match(html, /Rodando<\/h2><span class="muted">0<\/span>[\s\S]*Nenhuma sessão rodando\./);
  assert.match(html, /Board<\/h2><span class="muted">0 demandas em andamento<\/span>/);
  assert.deepEqual(
    [...html.matchAll(/<div class="etapa" style="grid-column: span (\d+)">(\w+)<\/div>/g)].map(
      (m) => `${String(m[2])}:${String(m[1])}`,
    ),
    ["Registrar:2", "Planejar:2", "Implementar:1", "Revisar:1", "Encerrar:5"],
  );
  assert.deepEqual(
    [
      ...html.matchAll(/<div class="coluna-cabeca">([^<]+) <span class="n">0<\/span>( <span class="tag tag-gate">)?/g),
    ].map((m) => `${String(m[1])}${m[2] ? " (gate)" : ""}`),
    [
      "Registro",
      "Aprovação da demanda (gate)",
      "Planejamento",
      "Aprovação do planejamento (gate)",
      "Desenvolvimento",
      "Revisão da rodada",
      "Encerramento da rodada",
      "Aprovação do PR (gate)",
      "Ajustes do PR",
      "Revisão da demanda",
      "Encerramento da demanda",
    ],
  );
  assert.equal(html.match(/coluna-vazia">vazia/g)?.length, 11);
  assert.equal(html.match(/class="coluna coluna-gate"/g)?.length, 3);
});

test("aguarda você: o contador, o motivo, o botão, o que falta e o rodapé de cada espera, na ordem que veio", () => {
  const html = inicio(
    dados({
      aguarda: [
        espera("gate_demanda", { ticket: { ref: "I-206.T1", etapa: "demanda" } }),
        espera("gate_planejamento"),
        espera("gate_pr", { rodada: "I-206.R1", pr: { id: "41", url: "https://pr/41" } }),
        espera("gate_pr", { rodada: "I-206.R3" }),
        espera("ajustes", { rodada: "I-206.R1", pr: { id: "41", url: "https://pr/41" } }),
        espera("ajustes", { rodada: "I-206.R3" }),
        espera("falha", {
          rodada: "I-206.R2",
          ticket: { ref: "I-206.T3", etapa: "implementar", modo: "autonomo" },
          erro: "serviço reiniciado",
        }),
        espera("falha"),
        espera("dialogo", { sessao: "s/1", pergunta: "Qual ordem?" }),
        espera("dialogo", { sessao: "s2" }),
        espera("conversa", { sessao: "s3", ticket: { ref: "I-206.T5", etapa: "planejar", modo: "interativo" } }),
      ],
    }),
    agora,
  );
  assert.match(html, /<span class="contador">11<\/span><span class="muted">da mais antiga para a mais nova<\/span>/);
  const cartoes = html.split('<a class="decisao').slice(1);
  const motivo = (c: string) => /decisao-motivo">([^<]+)<\/span><span class="([^"]+)">([^<]+)</.exec(c)?.slice(1);
  assert.deepEqual(cartoes.map(motivo), [
    ["Gate da demanda", "btn btn-primario btn-pequeno", "Avaliar a demanda →"],
    ["Gate do planejamento", "btn btn-primario btn-pequeno", "Avaliar o plano →"],
    ["Gate do PR", "btn btn-primario btn-pequeno", "Ver o PR →"],
    ["Gate do PR", "btn btn-primario btn-pequeno", "Ver o PR →"],
    ["Ajustes do PR", "btn btn-primario btn-pequeno", "Conversar →"],
    ["Ajustes do PR", "btn btn-primario btn-pequeno", "Conversar →"],
    ["Falhou", "btn btn-pequeno", "Reabrir o ticket →"],
    ["Falhou", "btn btn-pequeno", "Reabrir o ticket →"],
    ["Pergunta", "btn btn-primario btn-pequeno", "Responder →"],
    ["Pergunta", "btn btn-primario btn-pequeno", "Responder →"],
    ["Conversa", "btn btn-primario btn-pequeno", "Responder →"],
  ]);
  assert.deepEqual(
    cartoes.map((c) => /decisao-texto">([^<]*)</.exec(c)?.[1]),
    [
      "Registro enviado; falta aprovar",
      "Plano enviado; falta aprovar",
      "PR #41 aberto; aguarda a sua revisão no PR",
      "PR aberto; aguarda a sua revisão no PR",
      "PR #41 reprovado; converse com o agente sobre os ajustes",
      "PR reprovado; converse com o agente sobre os ajustes",
      "serviço reiniciado",
      "o agente falhou",
      "O agente pergunta: Qual ordem?",
      "O agente abriu uma pergunta",
      "O agente respondeu e espera você",
    ],
  );
  // Os gates, os ajustes e a falha se decidem na página da demanda; o diálogo e a conversa, no chat.
  assert.deepEqual(
    cartoes.map((c) => /^[^"]*" href="([^"]+)"/.exec(c)?.[1]),
    [...Array<string>(8).fill("/demandas/I-206"), "/sessions/s%2F1", "/sessions/s2", "/sessions/s3"],
  );
  assert.match(String(cartoes[6]), /^ superficie falha"/);
  assert.match(String(cartoes[0]), /^ superficie"/);
  assert.match(String(cartoes[0]), /<span class="id">I-206<\/span> Busca &#60;rápida&#62;/);
  assert.match(String(cartoes[2]), /<span class="id">I-206\.R1<\/span>/);
  assert.match(
    String(cartoes[0]),
    /<span class="tag">loja<\/span><span><span class="mono">I-206\.T1<\/span> · demanda · há 45\u00a0min<\/span>/,
  );
  assert.match(String(cartoes[6]), /I-206\.T3<\/span> · implementação · autônoma · há 45/);
  assert.match(String(cartoes[1]), /<span class="tag">loja<\/span><span>há 45\u00a0min<\/span>/);
});

test("rodando: a linha da sessão com o modo, o que o agente faz, o ticket, o modelo e há quanto tempo", () => {
  const html = inicio(
    dados({
      rodando: [
        sessao({ fazendo: "lendo src/<a>.ts", modelo: { provedor: "anthropic", modelo: "claude-opus-4-5" } }),
        sessao({ sessao: "s2", modo: "interativo" }),
      ],
    }),
    agora,
  );
  assert.match(html, /Rodando<\/h2><span class="muted">2<\/span>/);
  const [primeira, segunda] = html.split('<a class="rodando-linha"').slice(1);
  assert.match(String(primeira), /^ href="\/sessions\/s1">/);
  assert.match(String(primeira), /pill-rodando">autônoma<\/span>\s*<span class="id">I-206<\/span>/);
  assert.match(String(primeira), /Busca <span class="muted">— lendo src\/&#60;a&#62;\.ts<\/span>/);
  assert.match(String(primeira), /<span class="mono">I-206\.T3<\/span> · implementação<\/span>/);
  assert.match(String(primeira), /title="anthropic \/ claude-opus-4-5"/);
  assert.match(String(primeira), /tempo muted">há menos\u00a0de\u00a01\u00a0min</);
  assert.match(String(segunda), /pill-rodando">interativa<\/span>/);
  assert.match(String(segunda), /— Implementação<\/span>/);
  assert.match(String(segunda), /title="padrão do pi"/);
});

test("board: o cartão na coluna da fase, com o ticket em curso e as marcas de execução, espera e bloqueio", () => {
  const html = inicio(
    dados({
      emAndamento: 2,
      aguarda: [espera("falha", { rodada: "I-206.R2" }), espera("gate_pr", { rodada: "I-206.R1" })],
      rodando: [sessao()],
      board: [
        cartao({
          ticket: { ref: "I-206.T3", etapa: "implementar", status: "em_execucao", modo: "autonomo" },
          outros: 1,
        }),
        cartao({ coluna: "aprovacao_pull_request", ref: "I-206.R1" }),
        cartao({
          coluna: "aprovacao_demanda",
          ref: "I-207",
          demanda: "I-207",
          titulo: "Cache",
          ticket: { ref: "I-207.T1", etapa: "demanda", status: "aberto" },
          bloqueios: ["I-206", "I-205"],
        }),
        cartao({ coluna: "revisao_demanda", ref: "I-209", demanda: "I-209" }),
      ],
    }),
    agora,
  );
  assert.match(html, /2 demandas em andamento/);
  const desenvolvimento = coluna(html, "Desenvolvimento");
  assert.match(desenvolvimento, /<span class="n">1<\/span>/);
  assert.match(desenvolvimento, /<a class="cartao rodando aguarda" href="\/demandas\/I-206">/);
  assert.match(desenvolvimento, /<span class="id">I-206\.R2<\/span><span class="tag">loja<\/span>/);
  assert.match(
    desenvolvimento,
    /<div class="cartao-ticket"><span class="mono">I-206\.T3<\/span> implementação · autônoma · em execução \(\+1\)<\/div>/,
  );
  assert.match(
    desenvolvimento,
    /<span class="pill pill-rodando"><span>em execução · menos de 1\u00a0min<\/span><\/span><span class="pill pill-falha"><span>aguarda você · falha<\/span>/,
  );
  const pr = coluna(html, "Aprovação do PR");
  assert.match(pr, /<a class="cartao aguarda"/);
  assert.match(pr, /<span class="pill pill-aguarda"><span>aguarda você · gate do PR<\/span>/);
  assert.doesNotMatch(pr, /cartao-ticket/);
  const gate = coluna(html, "Aprovação da demanda");
  assert.match(gate, /<a class="cartao bloqueada" href="\/demandas\/I-207">/);
  assert.match(gate, /I-207\.T1<\/span> demanda · aberto<\/div>/);
  assert.match(
    gate,
    /<span class="pill pill-neutro"><span>bloqueada por <span class="mono">I-206<\/span>, <span class="mono">I-205<\/span><\/span>/,
  );
  // O endereço no título do cartão não quebra no hífen.
  assert.match(
    inicio(dados({ board: [cartao({ titulo: "Corrigir I-206.R1 & I-7" })] }), agora),
    /cartao-titulo">Corrigir <span class="endereco">I-206\.R1<\/span> &#38; <span class="endereco">I-7<\/span><\/div>/,
  );
  const revisao = coluna(html, "Revisão da demanda");
  assert.match(revisao, /<a class="cartao" href="\/demandas\/I-209">/);
  assert.doesNotMatch(revisao, /cartao-marcas/);
  assert.equal(html.match(/coluna-vazia/g)?.length, 7);
});

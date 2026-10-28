import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExecucaoSessao } from "../../../dominio/sessoes.ts";
import type { DadosDoChatDemanda, Entrada } from "../../rotas/chat.ts";
import type { SessaoDeDemanda } from "../../rotas/historico.ts";
import { consulta, contagem, dia, listaDoHistorico, paginaDoHistorico, previa } from "./historico.ts";

process.env.TZ = "America/Sao_Paulo";

const AGORA = new Date("2026-10-12T15:00:00.000Z");

const sessao = (s: Partial<SessaoDeDemanda> = {}): SessaoDeDemanda => ({
  sessao: "a1/b2",
  projeto: "loja <api>",
  demanda: "I-37",
  titulo: "Board <por> fase",
  ticket: "I-37.T109",
  etapa: "planejar",
  modo: "autonomo",
  estado: "terminada",
  desde: "2026-10-12T13:34:00.000Z",
  inicio: "2026-10-12T13:00:00.000Z",
  resultado: "concluida",
  ...s,
});

test("página: filtros de projeto, demanda e etapa com o que o Auditor escolheu, e o lugar da contagem e da lista", () => {
  const html = paginaDoHistorico(["loja", "site <pessoal>"], {
    projeto: "loja",
    demanda: 'I-"2',
    etapa: "revisar_rodada",
  });
  assert.match(html, /<h1>Histórico<\/h1><span class="muted">sessões terminadas, da mais recente para a mais antiga/);
  assert.match(html, /<option value="">todos<\/option><option value="loja" selected>loja<\/option>/);
  assert.match(html, /<option value="site &#60;pessoal&#62;">site &#60;pessoal&#62;<\/option>/);
  assert.match(html, /<input data-f="demanda" value="I-&#34;2" placeholder="I-29"/);
  assert.match(html, /<option value="implementar">implementação<\/option>/);
  assert.match(html, /<option value="revisar_rodada" selected>revisão da rodada<\/option>/);
  assert.match(html, /<span class="contagem" data-contagem><\/span><\/div><div data-lista><\/div>/);
  assert.doesNotMatch(html, /data-auditar|data-mes|data-pedido/);
});

test("consulta: só os filtros escolhidos, a demanda como I-n ou n, e nada a pedir se ela não é número", () => {
  assert.equal(consulta({ projeto: "", demanda: "", etapa: "" }), "escopo=historico");
  assert.equal(
    consulta({ projeto: "loja api", demanda: "i-29", etapa: "planejar" }),
    "escopo=historico&projeto=loja+api&demanda=I-29&etapa=planejar",
  );
  assert.equal(consulta({ projeto: "", demanda: "29", etapa: "" }), "escopo=historico&demanda=I-29");
  assert.equal(consulta({ projeto: "", demanda: "I-", etapa: "" }), undefined);
  assert.equal(consulta({ projeto: "", demanda: "cupom", etapa: "" }), undefined);
});

test("contagem e dia: Hoje, Ontem, a data e o ano quando não é o de agora, no fuso do navegador", () => {
  assert.deepEqual([contagem(0), contagem(1), contagem(12)], ["0 sessões", "1 sessão", "12 sessões"]);
  assert.equal(dia("2026-10-12T03:00:00.000Z", AGORA), "Hoje");
  assert.equal(dia("2026-10-12T02:59:00.000Z", AGORA), "Ontem");
  assert.equal(dia("2026-10-09T17:40:00.000Z", AGORA), "09/10");
  assert.equal(dia("2025-12-31T12:00:00.000Z", AGORA), "31/12/2025");
});

test("lista: por dia, da mais recente para a mais antiga como veio, com a selecionada marcada e a prévia ao lado", () => {
  const html = listaDoHistorico(
    [
      sessao(),
      sessao({ sessao: "x", desde: "2026-10-11T21:47:00.000Z", resultado: "falha", modo: "consulta" }),
      sessao({ sessao: "y", desde: "2026-10-08T19:58:00.000Z", etapa: "sessao_em_aberto", modo: "interativo" }),
    ],
    "x",
    AGORA,
  );
  assert.deepEqual(
    [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]),
    ["Hoje", "Ontem", "08/10"],
  );
  assert.ok(
    html.includes(
      '<button type="button" class="linha" data-sel="a1/b2" aria-selected="false"><span class="hora">10:34</span><span class="id">I-37</span><span class="id esconde">I-37.T109</span><span class="meio">Board &#60;por&#62; fase <span class="muted">· planejamento · autônoma</span></span><span class="esconde"><span class="pill pill-ok">concluída</span></span></button>',
    ),
  );
  assert.match(html, /data-sel="x" aria-selected="true"><span class="hora">18:47<\/span>/);
  assert.match(html, /· planejamento · consulta<\/span>.*pill-falha">falha</);
  assert.match(html, /· sessão em aberto · interativa<\/span>/);
  assert.match(html, /<aside class="previa superficie" data-previa aria-label="Prévia da sessão">/);
  assert.equal(listaDoHistorico([], "", AGORA), '<p class="muted">Nenhuma sessão com esses filtros.</p>');
});

const execucao = (e: Partial<ExecucaoSessao>): ExecucaoSessao => ({
  id: "e1",
  sessao_id: "a1/b2",
  inicio: "2026-10-12T13:00:00.000Z",
  fim: "2026-10-12T13:12:00.000Z",
  falha: false,
  ...e,
});

const msg = (message: Record<string, unknown>, extra: Partial<Entrada> = {}): Entrada => ({
  type: "message",
  message,
  ...extra,
});

/** A sessão no formato do chat da demanda: só o que a prévia lê. */
const dados = (conversa: Entrada[], execucoes: ExecucaoSessao[]): DadosDoChatDemanda =>
  ({ origem: "demanda", sessao: {}, execucoes, conversa }) as unknown as DadosDoChatDemanda;

test("prévia: os fatos da sessão, o fim da conversa e as ações", () => {
  const conversa = [
    msg({ role: "user", content: "# Contexto da etapa" }, { fabriquinha: true }),
    msg({ role: "user", content: "comece pelos testes" }),
    msg({ role: "assistant", content: [{ type: "text", text: "Vou ler." }] }),
    msg({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "toolCall", id: "t1", name: "bash", arguments: { command: "npm test" } },
        { type: "toolCall", id: "t2", name: "ler", arguments: { path: "a.ts" } },
        { type: "toolCall", id: "t3", name: "busca", arguments: { q: 1 } },
      ],
      provider: "anthropic",
      model: "claude-opus-5-5",
    }),
    msg({ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "ok 1\nok 2" }] }),
    msg({ role: "toolResult", toolCallId: "t2", isError: true, content: [{ type: "text", text: "sem <arquivo>" }] }),
    msg({
      role: "assistant",
      content: [
        { type: "text", text: "Desenho **submetido**." },
        { type: "text", text: " " },
      ],
      provider: "anthropic",
      model: "claude-opus-5-5",
    }),
    { type: "model_change" },
  ];
  const html = previa(
    sessao(),
    dados(conversa, [
      execucao({}),
      execucao({ id: "e2", inicio: "2026-10-12T13:20:00.000Z", fim: "2026-10-12T13:30:00.000Z" }),
      execucao({ id: "e3", fim: undefined }),
    ]),
    AGORA,
  );
  assert.ok(html.startsWith('<div><span class="id">I-37 · I-37.T109</span><h2>Board &#60;por&#62; fase</h2></div>'));
  assert.ok(
    html.includes(
      '<dt>Projeto</dt><dd>loja &#60;api&#62;</dd><dt>Etapa</dt><dd>planejamento · autônoma</dd><dt>Resultado</dt><dd><span class="pill pill-ok">concluída</span></dd><dt>Terminada</dt><dd>Hoje 10:34 · durou 22 min</dd><dt>Modelo</dt><dd><span class="modelo" title="anthropic / claude-opus-5-5">anthropic / claude-opus-5-5</span></dd><dt>Mensagens</dt><dd>4</dd>',
    ),
    html,
  );
  assert.ok(
    html.includes(
      // As chamadas, recolhíveis como no chat, e não achatadas numa linha.
      '<div class="trecho"><span class="quem">fim da conversa</span>' +
        '<details class="ferramenta" data-chamada="t2"><summary><span class="nome-f">ler</span><span class="args">a.ts</span><span class="res nok">✗ 1 linha</span></summary><pre>sem &#60;arquivo&#62;</pre></details>' +
        '<details class="ferramenta" data-chamada="t3"><summary><span class="nome-f">busca</span><span class="args">{&#34;q&#34;:1}</span><span class="res neutro">sem resultado ainda</span></summary></details>' +
        '<div><span class="quem">agente</span><div class="texto md"><p>Desenho <strong>submetido</strong>.</p>\n</div></div></div>',
    ),
    html,
  );
  assert.ok(
    html.endsWith(
      '<div class="botoes"><a class="btn btn-primario" href="/sessions/a1%2Fb2">Abrir o chat</a><a class="btn" href="/api/sessoes/a1%2Fb2/historico.md" download>Exportar</a></div>',
    ),
  );
  // O começo da conversa: a mensagem do Auditor e a chamada com o resultado que deu certo.
  const comeco = previa(sessao({ titulo: "Sem conversa" }), dados(conversa.slice(0, 3), []), AGORA);
  assert.match(comeco, /<h2>Sem conversa<\/h2>/);
  assert.match(comeco, /durou 0 s/);
  assert.match(comeco, /<span class="quem">você<\/span><div class="texto md"><p>comece pelos testes<\/p>/);
  assert.match(comeco, /<dt>Mensagens<\/dt><dd>2<\/dd>/);
  assert.match(
    previa(sessao(), dados(conversa.slice(1, 5), []), AGORA),
    /<span class="nome-f">bash<\/span><span class="args">npm test<\/span><span class="res ok">✓ 2 linhas<\/span>/,
  );
  // Sem mensagens, o fim da conversa diz isso.
  assert.match(
    previa(sessao(), dados([], []), AGORA),
    /fim da conversa<\/span><span class="muted">sem mensagens<\/span>/,
  );
});

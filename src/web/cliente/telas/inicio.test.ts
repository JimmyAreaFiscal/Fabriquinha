import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ticket } from "../../../dominio/agregado.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { MetricasMes } from "../../../metricas/periodo.ts";
import type { IssueDoBoard } from "../../rotas/inicio.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { formularioDeRegistro, inicio } from "./inicio.ts";

const AGORA = new Date("2026-10-12T15:00:00.000Z");
const ha = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString();

/** O mês corrente de `GET /api/metricas`, para a frase do Início e os cards do Projeto. */
const MES: MetricasMes = {
  mes: "2026-10",
  projeto: null,
  consumo: { chamadas: 3, tokens: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0 }, custo: 1.5 },
  modelos: [],
  issues: { registradas: 2, concluidas: 1 },
  tickets: { criados: 4, concluidos: 3 },
  prs: { abertos: 1, mergeados: 0 },
  notaPR: { media: null, notas: 0 },
  etapas: [],
};

const ticket = (t: Partial<Ticket> & Pick<Ticket, "id" | "issue" | "etapa" | "status">): Ticket => ({
  titulo: "t",
  descricao: "",
  origem: "fabriquinha",
  criadoEm: ha(300),
  ...t,
});

const issue = (i: Partial<IssueDoBoard> & Pick<IssueDoBoard, "id" | "fase">): IssueDoBoard => ({
  projeto: "loja",
  titulo: `Issue ${String(i.id)}`,
  tipo: "funcionalidade",
  descricao: "",
  deps: [],
  criadaEm: ha(600),
  tickets: [],
  ...i,
});

const sessao = (s: Partial<InfoSessao> & Pick<InfoSessao, "issue" | "ticket" | "estado">): InfoSessao => ({
  sessao: `s-${String(s.ticket)}`,
  projeto: "loja",
  etapa: "desenvolvimento",
  modo: "autonomo",
  execucao: 1,
  desde: ha(5),
  dialogos: [],
  ...s,
});

/** O texto visível do HTML, sem tags e com os espaços juntados. */
const texto = (html: string) =>
  html
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

/** Os pedaços do HTML que abrem com `<tag class="classe…` e vão até o fim do elemento de mesmo nível (`</a>`). */
const blocos = (html: string, classe: string) =>
  [...html.matchAll(new RegExp(`<a class="${classe}[^"]*"[^>]*>[\\s\\S]*?</a>`, "g"))].map((m) => m[0]);

test("aguarda você: um card por sessão, na ordem recebida, com motivo, issue, o que falta, contexto e a ação", () => {
  const board = [
    issue({
      id: 34,
      fase: "desenvolvimento",
      titulo: "Timeout no checkout <com cupom>",
      tickets: [ticket({ id: 101, issue: 34, etapa: "desenvolvimento", status: "falhou", erro: "3 testes falharam" })],
    }),
    issue({
      id: 29,
      fase: "aprovacao_pr",
      projeto: "site",
      pr: { id: "212", url: "https://github.com/x/site/pull/212" },
    }),
    issue({
      id: 37,
      fase: "aprovacao_desenho",
      tickets: [
        ticket({ id: 109, issue: 37, etapa: "desenho", status: "concluido" }),
        ticket({ id: 110, issue: 37, etapa: "desenvolvimento", status: "aberto" }),
        ticket({ id: 111, issue: 37, etapa: "desenvolvimento", status: "aberto" }),
      ],
    }),
    issue({
      id: 38,
      fase: "aprovacao_desenho",
      tickets: [ticket({ id: 120, issue: 38, etapa: "desenvolvimento", status: "aberto" })],
    }),
    issue({ id: 40, fase: "registro" }),
    issue({ id: 41, fase: "registro", titulo: null, tipo: null }),
  ];
  const aguarda = (s: Partial<InfoSessao> & Pick<InfoSessao, "issue" | "ticket">) =>
    sessao({ estado: "aguardando_humano", ...s });
  const sessoes = [
    aguarda({ issue: 34, ticket: 101, motivo: "falha", desde: ha(134) }),
    aguarda({ issue: 29, ticket: 99, motivo: "gate_pr", etapa: "encerramento", projeto: "site", desde: ha(80) }),
    aguarda({ issue: 37, ticket: 109, motivo: "gate_desenho", etapa: "desenho", desde: ha(47) }),
    aguarda({ issue: 38, ticket: 119, motivo: "gate_desenho", etapa: "desenho", desde: ha(30) }),
    aguarda({ issue: 40, ticket: 115, motivo: "gate_registro", etapa: "registro", modo: "interativo", desde: ha(22) }),
    aguarda({ issue: 27, ticket: 117, motivo: "conversa", etapa: "sessao", modo: "interativo", desde: ha(9) }),
    aguarda({
      issue: 41,
      ticket: 118,
      motivo: "dialogo",
      etapa: "registro",
      modo: "interativo",
      dialogos: [{ type: "extension_ui_request", title: "Qual formato?", em: ha(2) }],
    }),
    aguarda({
      issue: 41,
      ticket: 118,
      sessao: "s-sem-titulo",
      motivo: "dialogo",
      modo: "consulta",
      dialogos: [{ type: "extension_ui_request", em: ha(1) }],
    }),
    aguarda({ issue: 42, ticket: 130, sessao: "s-sem-motivo", desde: ha(0.5) }),
  ];
  const html = inicio({ sessoes, board, mes: MES }, AGORA);
  assert.match(
    texto(html),
    /^Início \+ Registrar necessidade .* Métricas → Aguarda você 9 da mais antiga para a mais nova /,
  );
  const cards = blocos(html, "decisao");
  assert.deepEqual(cards.map(texto), [
    "Falhou Responder e retomar → I-34 Timeout no checkout &#60;com cupom&#62; 3 testes falharam loja T-101 · desenvolvimento · autônoma · há 2 h 14 min",
    "Gate do PR Ver o PR → I-29 Issue 29 PR #212 aberto; aguarda a sua revisão no PR site T-99 · encerramento · autônoma · há 1 h 20 min",
    "Gate do desenho Avaliar desenho → I-37 Issue 37 2 tickets de desenvolvimento propostos loja T-109 · desenho · autônoma · há 47 min",
    "Gate do desenho Avaliar desenho → I-38 Issue 38 1 ticket de desenvolvimento proposto loja T-119 · desenho · autônoma · há 30 min",
    "Gate do registro Avaliar registro → I-40 Issue 40 Registro enviado; falta aprovar loja T-115 · registro · interativa · há 22 min",
    "Conversa Responder → I-27 sem título O agente respondeu e espera você loja T-117 · sessão em aberto · interativa · há 9 min",
    "Diálogo Responder → I-41 sem título O agente pergunta: Qual formato? loja T-118 · registro · interativa · há 5 min",
    "Diálogo Responder → I-41 sem título O agente abriu uma pergunta loja T-118 · desenvolvimento · consulta · há 5 min",
    "Conversa Responder → I-42 sem título O agente respondeu e espera você loja T-130 · desenvolvimento · autônoma · há menos de 1 min",
  ]);
  // Sem a evidência do PR (ainda não lida), o card fica sem o número.
  const semPR = inicio(
    { sessoes: sessoes.slice(1, 2), board: [issue({ id: 29, fase: "aprovacao_pr" })], mes: MES },
    AGORA,
  );
  assert.match(semPR, /PR aberto; aguarda a sua revisão no PR/);
  // O card inteiro abre o chat, ou a página da issue nos gates; a falha em vermelho, com o botão secundário.
  assert.match(cards[0] ?? "", /^<a class="decisao superficie falha" href="\/sessions\/s-101">/);
  assert.match(cards[0] ?? "", /<span class="btn btn-pequeno">Responder e retomar →<\/span>/);
  assert.match(cards[1] ?? "", /^<a class="decisao superficie" href="\/projects\/site\/issues\/I-29">/);
  assert.match(cards[4] ?? "", /^<a class="decisao superficie" href="\/projects\/loja\/issues\/I-40">/);
  assert.match(cards[5] ?? "", /^<a class="decisao superficie" href="\/sessions\//);
  assert.match(cards[1] ?? "", /<span class="btn btn-primario btn-pequeno">Ver o PR →<\/span>/);
});

test("aguarda você: o registro enviado pela IA externa, sem sessão, entra na ordem do envio e marca o cartão", () => {
  const externo = (id: number, enviadoEm?: string) =>
    issue({
      id,
      fase: "registro",
      tickets: [
        ticket({
          id: id * 10,
          issue: id,
          etapa: "registro",
          status: "em_execucao",
          origem: "externo",
          ...(enviadoEm && { enviadoEm }),
        }),
      ],
    });
  const board = [externo(50, ha(20)), externo(51), issue({ id: 34, fase: "desenvolvimento" })];
  const sessoes = [
    sessao({ issue: 34, ticket: 101, estado: "aguardando_humano", motivo: "falha", desde: ha(30) }),
    sessao({ issue: 34, ticket: 102, estado: "aguardando_humano", motivo: "conversa", desde: ha(10) }),
  ];
  const html = inicio({ sessoes, board, mes: MES }, AGORA);
  assert.match(texto(html), /Aguarda você 3 da mais antiga para a mais nova /);
  const cards = blocos(html, "decisao");
  assert.deepEqual(
    cards.map(texto).map((t) => t.split(" → ")[1]?.slice(0, 5)),
    ["I-34 ", "I-50 ", "I-34 "],
  );
  assert.equal(
    texto(cards[1] ?? ""),
    "Gate do registro Avaliar registro → I-50 Issue 50 Registro enviado por uma IA externa; falta aprovar loja T-500 · registro · IA externa · há 20 min",
  );
  assert.match(cards[1] ?? "", /^<a class="decisao superficie" href="\/projects\/loja\/issues\/I-50">/);
  const cartoes = blocos(html, "cartao");
  assert.match(
    cartoes.find((c) => c.includes("I-50")) ?? "",
    /<span class="pill pill-aguarda">aguarda você · gate do registro<\/span>/,
  );
  assert.doesNotMatch(cartoes.find((c) => c.includes("I-51")) ?? "", /aguarda você/);
});

test("rodando: uma linha por sessão com modo, issue, o que o agente faz, ticket e etapa, modelo e tempo", () => {
  const board = [
    issue({
      id: 38,
      fase: "desenho",
      titulo: "Limite de tentativas no login",
      tickets: [ticket({ id: 112, issue: 38, etapa: "desenho", status: "em_execucao", titulo: "Desenhar a solução" })],
    }),
  ];
  const sessoes = [
    sessao({
      issue: 38,
      ticket: 112,
      estado: "rodando",
      etapa: "desenho",
      modelo: { provedor: "anthropic", modelo: "claude-opus-5-5" },
      desde: ha(6),
    }),
    sessao({ issue: 38, ticket: 112, sessao: "consulta", estado: "rodando", modo: "consulta", desde: ha(1) }),
    sessao({ issue: 22, ticket: 90, estado: "rodando", modo: "interativo" }),
    // O que o processo vivo diz que o agente faz agora vence o título do ticket.
    sessao({ issue: 38, ticket: 112, sessao: "viva", estado: "rodando", atividade: "bash npm test <x>" }),
  ];
  const html = inicio({ sessoes, board, mes: MES }, AGORA);
  assert.match(texto(html), /Aguarda você Nada aguarda você agora\. Rodando 4 /);
  assert.deepEqual(blocos(html, "rodando-linha").map(texto), [
    "autônoma I-38 Limite de tentativas no login — Desenhar a solução T-112 · desenho anthropic / claude-opus-5-5 há 6 min",
    "consulta I-38 Limite de tentativas no login — Respondendo à sua pergunta T-112 · desenvolvimento padrão do pi há 1 min",
    "interativa I-22 sem título — Trabalhando T-90 · desenvolvimento padrão do pi há 5 min",
    "autônoma I-38 Limite de tentativas no login — bash npm test &#60;x&#62; T-112 · desenvolvimento padrão do pi há 5 min",
  ]);
  assert.match(html, /<a class="rodando-linha" href="\/sessions\/consulta">/);
});

test("board: colunas por fase sob as 5 etapas, gates hachurados, cartões com ticket e marcas; vazio diz vazia", () => {
  const vazio = inicio({ sessoes: [], board: [], mes: MES }, AGORA);
  assert.match(texto(vazio), /Rodando 0 Nenhuma sessão rodando\. Board 0 issues em andamento /);
  assert.match(
    texto(vazio),
    /^Início \+ Registrar necessidade Outubro de 2026, todos os projetos: US\$ 1,50 · 1,5 mil tokens · issues 2 registradas, 1 concluídas .* Métricas → Aguarda você/,
  );
  assert.deepEqual(
    [...vazio.matchAll(/<div class="etapa" style="grid-column: span (\d)">([^<]+)</g)].map((m) => [m[2], m[1]]),
    [
      ["Registrar", "1"],
      ["Desenhar", "2"],
      ["Implementar", "1"],
      ["Revisar", "1"],
      ["Encerrar", "3"],
    ],
  );
  assert.deepEqual(
    [
      ...vazio.matchAll(
        /<div class="(coluna[^"]*)">\s*<div class="coluna-cabeca">([^<]+)<span class="n">0<\/span>(<span class="tag tag-gate">gate<\/span>)?/g,
      ),
    ].map((m) => [m[1], m[2], Boolean(m[3])]),
    [
      ["coluna", "Registro", false],
      ["coluna", "Desenho", false],
      ["coluna coluna-gate", "Aprovação do desenho", true],
      ["coluna", "Desenvolvimento", false],
      ["coluna", "Revisão", false],
      ["coluna", "Encerramento", false],
      ["coluna coluna-gate", "Aprovação do PR", true],
      ["coluna", "Ajuste do PR", false],
    ],
  );
  assert.equal(vazio.match(/coluna-vazia">vazia</g)?.length, 8);

  const board = [
    issue({
      id: 41,
      fase: "registro",
      titulo: null,
      tipo: null,
      projeto: "loja api",
      tickets: [ticket({ id: 118, issue: 41, etapa: "registro", status: "em_execucao" })],
    }),
    issue({
      id: 39,
      fase: "desenho",
      deps: [35, 12],
      tickets: [
        ticket({ id: 105, issue: 39, etapa: "registro", status: "concluido" }),
        ticket({ id: 113, issue: 39, etapa: "desenho", status: "aberto" }),
      ],
    }),
    issue({
      id: 35,
      fase: "desenvolvimento",
      tickets: [
        ticket({ id: 101, issue: 35, etapa: "desenvolvimento", status: "falhou" }),
        ticket({ id: 102, issue: 35, etapa: "desenvolvimento", status: "aberto" }),
        ticket({ id: 103, issue: 35, etapa: "desenvolvimento", status: "aberto" }),
      ],
    }),
    issue({ id: 29, fase: "aprovacao_pr" }),
  ];
  const sessoes = [
    sessao({ issue: 41, ticket: 118, estado: "aguardando_humano", motivo: "conversa" }),
    sessao({ issue: 41, ticket: 118, sessao: "c1", estado: "aguardando_humano", motivo: "dialogo", modo: "consulta" }),
    sessao({ issue: 41, ticket: 118, sessao: "c2", estado: "rodando", modo: "consulta", desde: ha(6) }),
    sessao({ issue: 35, ticket: 101, estado: "aguardando_humano", motivo: "falha" }),
    sessao({ issue: 29, ticket: 99, estado: "aguardando_humano" }),
  ];
  const html = inicio({ sessoes, board, mes: MES }, AGORA);
  assert.match(texto(html), /Board 4 issues em andamento/);
  const cartoes = blocos(html, "cartao");
  assert.deepEqual(cartoes.map(texto), [
    "I-41 loja api sem título T-118 registro · em execução aguarda você · responder em execução · 6 min",
    "I-39 loja Issue 39 T-113 desenho · aberto bloqueada por I-35",
    "I-35 loja Issue 35 T-101 desenvolvimento · falhou (+2) aguarda você · falha",
    "I-29 loja Issue 29 aguarda você · responder",
  ]);
  assert.match(cartoes[0] ?? "", /^<a class="cartao aguarda rodando" href="\/projects\/loja%20api\/issues\/I-41">/);
  assert.match(cartoes[0] ?? "", /<div class="cartao-titulo sem">sem título<\/div>/);
  assert.match(
    cartoes[0] ?? "",
    /<span class="pill pill-aguarda">aguarda você · responder<\/span><span class="pill pill-rodando">em execução · 6\u00a0min<\/span>/,
  );
  assert.match(cartoes[1] ?? "", /^<a class="cartao bloqueada" href="\/projects\/loja\/issues\/I-39">/);
  assert.match(cartoes[1] ?? "", /<span class="pill pill-neutro">bloqueada por I-35<\/span>/);
  assert.match(cartoes[2] ?? "", /<span class="pill pill-falha">aguarda você · falha<\/span>/);
  assert.doesNotMatch(cartoes[3] ?? "", /cartao-ticket/);
  // Cada cartão na coluna da fase dele.
  const coluna = (nome: string) =>
    texto(new RegExp(`<div class="coluna-cabeca">${nome}[\\s\\S]*?(?=<div class="coluna[ "]|$)`).exec(html)?.[0] ?? "");
  assert.match(coluna("Registro"), /^Registro 1 I-41/);
  assert.match(coluna("Aprovação do PR"), /^Aprovação do PR 1 gate I-29/);
  assert.match(
    texto(inicio({ sessoes: [], board: [issue({ id: 1, fase: "registro" })], mes: MES }, AGORA)),
    /Board 1 issue em andamento/,
  );
});

const projeto = (nome: string): ProjetoListado => ({
  nome,
  repo: `/code/${nome}`,
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  testes: ["npm test"],
  sonar: { projectKey: nome },
  fitness: [],
  modelos: {},
  issues: 0,
});

test("registro: projeto e dependências entre as issues em andamento; sem projeto, manda cadastrar", () => {
  const sem = formularioDeRegistro([], []);
  assert.equal(texto(sem), "Nenhum projeto cadastrado ainda. Cadastrar um projeto na Configuração");
  assert.match(sem, /<a class="link" href="\/config\?novo" data-fechar>/);

  const issues = [
    issue({ id: 41, fase: "registro", titulo: null }),
    issue({ id: 35, fase: "desenvolvimento", titulo: "Cache <x>", projeto: "site" }),
  ];
  const html = formularioDeRegistro([projeto("loja"), projeto("site")], issues, "site");
  assert.match(html, /<option value="loja">loja<\/option><option value="site" selected>site<\/option>/);
  assert.match(
    html,
    /<input type="checkbox" name="deps" value="41"><span class="id">I-41<\/span><span class="dep-titulo sem">sem título<\/span><span class="tag">loja<\/span>/,
  );
  assert.match(
    html,
    /value="35"><span class="id">I-35<\/span><span class="dep-titulo">Cache &#60;x&#62;<\/span><span class="tag">site<\/span>/,
  );
  assert.match(
    html,
    /<\/select><\/label>\s*<label class="campo">Descrição<textarea name="descricao" rows="5" placeholder="O problema ou a funcionalidade, em poucas frases"><\/textarea><\/label>\s*<fieldset/,
  );
  assert.doesNotMatch(html, /required/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.match(texto(html), /Cancelar Registrar e abrir o chat$/);

  const recusado = formularioDeRegistro([projeto("loja")], [], undefined, "o projeto <loja> não existe");
  assert.doesNotMatch(recusado, /selected/);
  assert.match(recusado, /<span class="ajuda">Nenhuma issue em andamento\.<\/span>/);
  assert.match(recusado, /<span class="msg-erro falha" role="alert">o projeto &#60;loja&#62; não existe<\/span>/);

  const mantido = formularioDeRegistro([projeto("loja")], [], "loja", "recusado", "CSV de <pedidos>");
  assert.match(mantido, /<textarea name="descricao"[^>]*>CSV de &#60;pedidos&#62;<\/textarea>/);
});

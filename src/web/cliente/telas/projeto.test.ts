import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ticket } from "../../../dominio/agregado.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { IssueDoProjeto, ListaDoProjeto } from "../../rotas/projeto.ts";
import type { ProjetoListado } from "./configuracao.ts";
import {
  caminhoDoProjeto,
  confirmacaoDeArquivar,
  escolherProjeto,
  type Escolhas,
  paginaDoProjeto,
  projetoNaoEncontrado,
} from "./projeto.ts";

const AGORA = new Date("2026-10-12T15:00:00.000Z");
const ha = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString();

const projeto = (nome: string): ProjetoListado => ({
  nome,
  repo: `/repos/${nome}`,
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  testes: ["npm test"],
  sonar: { projectKey: nome },
  fitness: [],
  modelos: { desenvolvimento: { provedor: "anthropic", modelo: "claude-sonnet-5-5" } },
  issues: 0,
});
const PROJETOS = [projeto("fabriquinha"), projeto("loja <api>")];

const ticket = (t: Partial<Ticket> & Pick<Ticket, "id" | "issue" | "etapa" | "status">): Ticket => ({
  titulo: `Ticket ${String(t.id)}`,
  descricao: "",
  origem: "fabriquinha",
  criadoEm: ha(300),
  ...t,
});

const issue = (i: Partial<IssueDoProjeto> & Pick<IssueDoProjeto, "id" | "fase">): IssueDoProjeto => ({
  projeto: "loja <api>",
  titulo: `Issue ${String(i.id)}`,
  tipo: "funcionalidade",
  descricao: "",
  deps: [],
  criadaEm: ha(600),
  tickets: [ticket({ id: i.id * 10, issue: i.id, etapa: "registro", status: "concluido" })],
  bloqueadaPor: [],
  ...i,
});

const sessao = (s: Partial<InfoSessao> & Pick<InfoSessao, "issue" | "ticket" | "estado">): InfoSessao => ({
  sessao: `s-${String(s.ticket)}`,
  projeto: "loja <api>",
  etapa: "desenvolvimento",
  modo: "autonomo",
  execucao: 1,
  desde: ha(5),
  dialogos: [],
  ...s,
});

const NADA: Escolhas = { mostrar: { concluidas: false, arquivadas: false }, gavetas: new Map() };
const VAZIA: ListaDoProjeto = { issues: [], sessoes: [], contagem: { andamento: 0, concluidas: 0, arquivadas: 0 } };

const texto = (html: string) =>
  html
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

/** O HTML de cada `.pista-item`, pelo número da issue. */
const item = (html: string, id: number) => {
  const inicio = html.indexOf(`data-issue="${String(id)}"`);
  assert.ok(inicio >= 0, `I-${String(id)} não está na página`);
  const fim = html.indexOf('<div class="pista-item', inicio);
  return html.slice(html.lastIndexOf("<div", inicio), fim < 0 ? undefined : fim);
};

test("/projects escolhe o último projeto visto, se ainda existe, ou o primeiro em ordem alfabética", () => {
  assert.equal(escolherProjeto(PROJETOS, "loja <api>"), "loja <api>");
  assert.equal(escolherProjeto(PROJETOS, "apagado"), "fabriquinha");
  assert.equal(escolherProjeto(PROJETOS), "fabriquinha");
  assert.equal(escolherProjeto([], "loja"), undefined);
  assert.equal(caminhoDoProjeto("loja <api>"), "/projects/loja%20%3Capi%3E");
  assert.match(projetoNaoEncontrado("<x>"), /O projeto &#60;x&#62; não está cadastrado/);
});

test("cabeçalho com o seletor, Editar na Configuração e Registrar; barra com a contagem, os filtros e Arquivar", () => {
  const html = paginaDoProjeto(PROJETOS, "loja <api>", VAZIA, NADA, AGORA);
  assert.match(html, /<option>fabriquinha<\/option><option selected>loja &#60;api&#62;<\/option>/);
  assert.match(html, /<a class="editar" href="\/config\?projeto=loja%20%3Capi%3E">Editar na Configuração<\/a>/);
  assert.match(html, /data-registrar>\+ Registrar necessidade</);
  assert.match(html, /<span class="contagem">0 em andamento · 0 concluídas · 0 arquivadas<\/span>/);
  assert.match(html, /<input type="checkbox" data-mostrar="concluidas"> Mostrar concluídas/);
  assert.match(html, /data-arquivar disabled>Arquivar concluídas/);
  assert.match(html, /<p class="vazio">Nenhuma issue.<\/p>/);
  assert.doesNotMatch(html, /pista-cabeca/);

  const marcado = paginaDoProjeto(
    PROJETOS,
    "fabriquinha",
    { ...VAZIA, contagem: { andamento: 3, concluidas: 1, arquivadas: 1 } },
    { ...NADA, mostrar: { concluidas: true, arquivadas: true } },
    AGORA,
  );
  assert.match(marcado, /3 em andamento · 1 concluída · 1 arquivada/);
  assert.match(marcado, /data-mostrar="concluidas" checked> Mostrar concluídas/);
  assert.match(marcado, /data-mostrar="arquivadas" checked> Mostrar arquivadas/);
  assert.match(marcado, /data-arquivar>Arquivar concluídas/);
});

test("a confirmação do Arquivar concluídas diz quantas e que nada é apagado", () => {
  assert.equal(
    texto(confirmacaoDeArquivar(2, "loja <api>")),
    'Arquivar concluídas 2 issues concluídas de loja <api> serão arquivadas. Elas saem desta lista e continuam acessíveis em "Mostrar arquivadas". Nada é apagado. Cancelar Arquivar'.replace(
      "<api>",
      "&#60;api&#62;",
    ),
  );
  assert.match(
    texto(confirmacaoDeArquivar(1, "loja")),
    /^Arquivar concluídas 1 issue concluída de loja será arquivada. Ela sai desta lista e continua acessível em/,
  );
});

test("linha por issue: título, I-n, tipo, bloqueio, PR, progresso, trilho com a cor do estado e a sessão ativa", () => {
  const lista: ListaDoProjeto = {
    issues: [
      issue({ id: 41, fase: "registro", titulo: null, tipo: null }),
      issue({
        id: 35,
        fase: "desenvolvimento",
        titulo: "Cache <do> catálogo",
        bloqueadaPor: [30, 31],
        pr: { id: "212", url: "https://github.com/x/loja/pull/212?a=1&b=2" },
        tickets: [
          ticket({ id: 95, issue: 35, etapa: "registro", status: "concluido" }),
          ticket({ id: 102, issue: 35, etapa: "desenvolvimento", status: "em_execucao" }),
          ticket({ id: 103, issue: 35, etapa: "desenvolvimento", status: "aberto" }),
          ticket({ id: 104, issue: 35, etapa: "desenvolvimento", status: "falhou" }),
        ],
      }),
      issue({ id: 34, fase: "aprovacao_pr" }),
      issue({ id: 33, fase: "desenho" }),
    ],
    sessoes: [
      sessao({ issue: 41, ticket: 410, estado: "aguardando_humano", motivo: "conversa", etapa: "registro" }),
      sessao({ issue: 35, ticket: 102, estado: "rodando", desde: ha(6) }),
      sessao({ issue: 35, ticket: 103, estado: "aguardando_humano", motivo: "dialogo" }),
      sessao({ issue: 35, ticket: 104, estado: "aguardando_humano", motivo: "falha", desde: ha(134) }),
      sessao({ issue: 34, ticket: 340, estado: "aguardando_humano" }),
      sessao({ issue: 33, ticket: 330, estado: "rodando", modo: "consulta" }),
    ],
    contagem: { andamento: 4, concluidas: 0, arquivadas: 0 },
  };
  const html = paginaDoProjeto(PROJETOS, "loja <api>", lista, NADA, AGORA);
  // O cabeçalho do trilho: as 5 etapas sobre as 8 fases, as de gate marcadas.
  assert.match(html, /<div class="pista-etapa" style="grid-column: span 2">Desenhar<\/div>/);
  assert.match(html, /<div class="pista-fase gate">Aprovação do PR<\/div>/);
  assert.equal(html.match(/class="pista-item/g)?.length, 4);

  const semTitulo = item(html, 41);
  assert.match(semTitulo, /^<div class="pista-item aguarda" data-issue="41">/);
  assert.match(semTitulo, /<a class="titulo sem" href="\/projects\/loja%20%3Capi%3E\/issues\/I-41">sem título<\/a>/);
  assert.doesNotMatch(semTitulo, /class="tag"/);
  assert.match(semTitulo, /aria-expanded="true" aria-label="Tickets de I-41"/);
  assert.match(semTitulo, /<ol class="trilho-fases aguarda"/);

  // A falha vence o que roda: a cor, a gaveta aberta e a sessão em destaque.
  const cache = item(html, 35);
  assert.match(cache, /^<div class="pista-item falha" data-issue="35">/);
  assert.match(cache, /<a class="titulo" href="[^"]+">Cache &#60;do&#62; catálogo<\/a>/);
  assert.match(
    texto(cache),
    /^▼ Cache &#60;do&#62; catálogo I-35 funcionalidade bloqueada por I-30, I-31 PR #212 1\/4 Registro .* Ajuste do PR Falhou há 2 h 14 min chat →/,
  );
  assert.match(cache, /<a class="pr" href="https:\/\/github.com\/x\/loja\/pull\/212\?a=1&#38;b=2" target="_blank"/);
  assert.match(cache, /<i style="width:25%"><\/i>/);
  assert.match(
    cache,
    /<div class="pista-estado"><a class="chat" href="\/sessions\/s-104"><span class="pill pill-falha">/,
  );

  const gatePr = item(html, 34);
  assert.match(gatePr, /^<div class="pista-item aguarda" data-issue="34">/);
  assert.match(gatePr, /<span class="pill pill-aguarda">Conversa<\/span>/);

  const consulta = item(html, 33);
  assert.match(consulta, /^<div class="pista-item rodando fechada" data-issue="33">/);
  assert.match(consulta, /aria-expanded="false"/);
  assert.match(consulta, /<span class="pill pill-rodando">Consulta<\/span>/);
  // O que roda no modo autônomo.
  assert.match(cache, /<span class="pill pill-rodando">Rodando<\/span><span class="muted quando">há 6 min<\/span>/);
});

test("a gaveta lista os tickets com etapa, status, modelo (★ no override) e sessão; o Auditor a abre ou fecha", () => {
  const i = issue({
    id: 22,
    fase: "concluida",
    concluidaEm: "2026-10-03T12:00:00.000Z",
    tickets: [
      ticket({ id: 60, issue: 22, etapa: "registro", status: "concluido", titulo: "Registrar <a>" }),
      ticket({
        id: 66,
        issue: 22,
        etapa: "desenvolvimento",
        status: "concluido",
        modelo: { provedor: "llamacpp", modelo: "qwen3-coder-30b" },
      }),
      ticket({ id: 90, issue: 22, etapa: "desenvolvimento", status: "concluido" }),
      ticket({ id: 91, issue: 22, etapa: "sessao", status: "aberto" }),
    ],
  });
  const arquivada = issue({
    id: 12,
    fase: "concluida",
    concluidaEm: "2026-09-01T12:00:00.000Z",
    arquivadaEm: "2026-09-02T12:00:00.000Z",
  });
  const lista: ListaDoProjeto = {
    issues: [i, arquivada, issue({ id: 5, fase: "desenho" })],
    sessoes: [sessao({ issue: 22, ticket: 90, estado: "rodando", modo: "consulta", desde: ha(1) })],
    contagem: { andamento: 1, concluidas: 1, arquivadas: 1 },
  };
  const gavetas = new Map([
    [22, true],
    [5, false],
  ]);
  const html = paginaDoProjeto(PROJETOS, "loja <api>", lista, { ...NADA, gavetas }, AGORA);
  const concluida = item(html, 22);
  assert.match(concluida, /^<div class="pista-item rodando apagada" data-issue="22">/);
  assert.match(texto(concluida), /I-22 funcionalidade 3\/4 concluída em 03\/10 Registro/);
  assert.match(concluida, /<span>concluída em 03\/10<\/span>/);
  const linhas = concluida.split("<tr").slice(1);
  assert.equal(linhas.length, 4);
  assert.match(linhas[0] ?? "", /^ class="apagada">/);
  assert.equal(texto(`<tr${linhas[0] ?? ""}`), "registro T-60 Registrar &#60;a&#62; concluído padrão do pi");
  assert.match(linhas[0] ?? "", /<span class="modelo" title="modelo da etapa no projeto">padrão do pi<\/span>/);
  assert.match(
    linhas[1] ?? "",
    /<span class="modelo override" title="modelo do ticket \(override\)">llamacpp \/ qwen3-coder-30b ★<\/span>/,
  );
  assert.match(linhas[2] ?? "", /^>/);
  assert.match(linhas[2] ?? "", /anthropic \/ claude-sonnet-5-5/);
  assert.match(linhas[2] ?? "", /<a class="chat" href="\/sessions\/s-90">/);
  assert.match(texto(`<tr${linhas[3] ?? ""}`), /^sessão em aberto T-91 Ticket 91 aberto padrão do pi$/);
  assert.match(item(html, 12), /<span>arquivada em 02\/09<\/span>/);
  assert.match(item(html, 5), /^<div class="pista-item fechada" data-issue="5">/);

  // Fora da lista de projetos, o modelo da etapa é o padrão do pi.
  assert.doesNotMatch(paginaDoProjeto([], "outro", lista, NADA, AGORA), /claude-sonnet/);
});

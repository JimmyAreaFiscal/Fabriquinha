// Histórico (F7 §4.4; F4 §5.3) como funções puras que devolvem HTML: os filtros com a contagem, as sessões terminadas
// agrupadas por dia e a prévia da escolhida, com o fim da conversa e as ações. O texto que vem do servidor passa
// sempre por `escapar`; o das mensagens, pelo `markdown-it` sem HTML.
import type { Etapa } from "../../../dominio/primitivos.ts";
import type { DadosDoChat } from "../../rotas/chat.ts";
import type { Resultado, SessaoDoHistorico } from "../../rotas/historico.ts";
import { markdown } from "../markdown.ts";
import {
  caminhoDaSessao,
  custo,
  diaMes,
  duracao,
  escapar,
  etapa,
  hora,
  MODO_DA_SESSAO,
  plural,
  rotuloDoModelo,
  rotuloIssue,
  rotuloTicket,
} from "../render.ts";
import { type Bloco, blocos, ferramenta, type MensagemPi, modeloDe, textoDe } from "./chat.ts";

/** O que o Auditor escolheu nos filtros, como digitou. */
export interface Filtros {
  projeto: string;
  issue: string;
  etapa: string;
}

const ETAPAS: readonly Etapa[] = ["registro", "desenho", "desenvolvimento", "revisao", "encerramento", "sessao"];

const RESULTADOS: Record<Resultado, [rotulo: string, pilula: string]> = {
  concluida: ["concluída", "pill-ok"],
  falha: ["falha", "pill-falha"],
  abortada: ["abortada", "pill-neutro"],
  cancelada: ["cancelada", "pill-neutro"],
};

const selecionado = (valor: string, atual: string): string => (valor === atual ? " selected" : "");

/** O cabeçalho e os filtros (F7 §4.4, item 1), com a lista vazia até as sessões chegarem. */
export function paginaDoHistorico(projetos: readonly string[], f: Filtros): string {
  const opcoesDeProjeto = projetos
    .map((p) => `<option value="${escapar(p)}"${selecionado(p, f.projeto)}>${escapar(p)}</option>`)
    .join("");
  const opcoesDeEtapa = ETAPAS.map((e) => `<option value="${e}"${selecionado(e, f.etapa)}>${etapa(e)}</option>`).join(
    "",
  );
  return (
    `<div class="pagina-historico">` +
    `<div class="cabeca-pagina"><h1>Histórico</h1><span class="muted">sessões terminadas, da mais recente para a mais antiga</span></div>` +
    `<div class="filtros">` +
    `<label>Projeto <select data-f="projeto"><option value="">todos</option>${opcoesDeProjeto}</select></label>` +
    `<label>Issue <input data-f="issue" value="${escapar(f.issue)}" placeholder="I-29" spellcheck="false" autocomplete="off"></label>` +
    `<label>Etapa <select data-f="etapa"><option value="">todas</option>${opcoesDeEtapa}</select></label>` +
    `<span class="contagem" data-contagem></span></div>` +
    `<div data-lista></div></div>`
  );
}

/**
 * A query de `GET /api/sessoes` com os filtros; a issue vale como `I-29` ou `29`. Issue que não é número não casa
 * com nenhuma sessão: `undefined`, sem pedir nada.
 */
export function consulta(f: Filtros): string | undefined {
  const issue = /^(?:i-?)?(\d+)$/i.exec(f.issue)?.[1];
  if (f.issue !== "" && issue === undefined) return undefined;
  const q = new URLSearchParams({ escopo: "historico" });
  if (f.projeto) q.set("projeto", f.projeto);
  if (issue) q.set("issue", issue);
  if (f.etapa) q.set("etapa", f.etapa);
  return q.toString();
}

export const contagem = (n: number): string => plural(n, "sessão", "sessões");

/** O dia da sessão, no fuso do navegador: `Hoje`, `Ontem` ou `09/10` (com o ano, se não é o de agora). */
export function dia(instante: string, agora: Date): string {
  const d = new Date(instante);
  const meiaNoite = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((meiaNoite(agora) - meiaNoite(d)) / 86_400_000);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  const ano = d.getFullYear() === agora.getFullYear() ? "" : `/${String(d.getFullYear())}`;
  return `${diaMes(d)}${ano}`;
}

const pilula = (r: Resultado): string => `<span class="pill ${RESULTADOS[r][1]}">${RESULTADOS[r][0]}</span>`;

const linha = (s: SessaoDoHistorico, selecionada: string): string =>
  `<button type="button" class="linha" data-sel="${escapar(s.sessao)}" aria-selected="${String(s.sessao === selecionada)}">` +
  `<span class="hora">${hora(new Date(s.desde))}</span><span class="id">${rotuloIssue(s.issue)}</span>` +
  `<span class="id esconde">${rotuloTicket(s.ticket)}</span>` +
  `<span class="meio">${escapar(s.titulo ?? "sem título")} <span class="muted">· ${etapa(s.etapa)} · ${MODO_DA_SESSAO[s.modo]}</span></span>` +
  `<span class="esconde">${pilula(s.resultado)}</span><span class="num muted">${custo(s.custo)}</span></button>`;

/**
 * A lista (F7 §4.4, item 2), já da mais recente para a mais antiga, agrupada por dia, com o lugar da prévia da
 * `selecionada` ao lado. Sem sessões, a frase de lista vazia.
 */
export function listaDoHistorico(lista: readonly SessaoDoHistorico[], selecionada: string, agora: Date): string {
  if (lista.length === 0) return '<p class="muted">Nenhuma sessão com esses filtros.</p>';
  const dias = Map.groupBy(lista, (s) => dia(s.desde, agora));
  const secoes = [...dias].map(
    ([d, ss]) => `<section class="dia"><h3>${d}</h3>${ss.map((s) => linha(s, selecionada)).join("")}</section>`,
  );
  return `<div class="mestre"><div>${secoes.join("")}</div><aside class="previa superficie" data-previa aria-label="Prévia da sessão"><p class="muted">Carregando a sessão…</p></aside></div>`;
}

/** Um pedaço do fim da conversa: uma chamada de ferramenta com o resultado, ou quem falou e o texto. */
type Pedaco = { chamada: Bloco; resultado?: MensagemPi } | { quem: string; texto: string };

/** As mensagens do Auditor e do agente da conversa, sem os prompts montados pela Fabriquinha. */
const mensagens = (d: DadosDoChat): MensagemPi[] =>
  d.conversa.flatMap((e) =>
    e.type === "message" && !e.fabriquinha && ["user", "assistant"].includes(String((e.message as MensagemPi).role))
      ? [e.message as MensagemPi]
      : [],
  );

/** Os últimos pedaços da conversa (F7 §4.4, item 3, "o fim da conversa"). */
function fimDaConversa(d: DadosDoChat, quantos = 3): Pedaco[] {
  const resultados = new Map(
    d.conversa
      .map((e) => e.message as MensagemPi | undefined)
      .filter((m) => m?.role === "toolResult")
      .map((m) => [String(m?.toolCallId), m] as const),
  );
  const pedacos = mensagens(d).flatMap((m): Pedaco[] => {
    if (m.role === "user") return [{ quem: "você", texto: textoDe(m) }];
    return blocos(m).flatMap((b): Pedaco[] => {
      if (b.type === "toolCall") return [{ chamada: b, resultado: resultados.get(String(b.id)) }];
      return b.type === "text" && b.text?.trim() ? [{ quem: "agente", texto: b.text }] : [];
    });
  });
  return pedacos.slice(-quantos);
}

/** A chamada sai recolhível, como no chat (F7 §4.4, Chat, item 2). */
const pedaco = (p: Pedaco): string =>
  "chamada" in p
    ? ferramenta(p.chamada, p.resultado)
    : `<div><span class="quem">${p.quem}</span><div class="texto md">${markdown(p.texto)}</div></div>`;

/**
 * A prévia (F7 §4.4, item 3): issue, ticket e título, projeto, etapa e modo, resultado, término e duração (a soma das
 * execuções), custo e modelo, mensagens e o fim da conversa; **Abrir o chat**, **Conversar sobre** e **Exportar**.
 */
export function previa(s: SessaoDoHistorico, d: DadosDoChat, agora: Date): string {
  const sessao = encodeURIComponent(s.sessao);
  const durou = d.execucoes.reduce(
    (soma, e) => soma + (e.terminadaEm ? Date.parse(e.terminadaEm) - Date.parse(e.iniciadaEm) : 0),
    0,
  );
  const fim = fimDaConversa(d);
  return (
    `<div><span class="id">${rotuloIssue(s.issue)} · ${rotuloTicket(s.ticket)}</span><h2>${escapar(s.titulo ?? "sem título")}</h2></div>` +
    `<dl class="fatos">` +
    `<dt>Projeto</dt><dd>${escapar(s.projeto)}</dd>` +
    `<dt>Etapa</dt><dd>${etapa(s.etapa)} · ${MODO_DA_SESSAO[s.modo]}</dd>` +
    `<dt>Resultado</dt><dd>${pilula(s.resultado)}</dd>` +
    `<dt>Terminada</dt><dd>${dia(s.desde, agora)} ${hora(new Date(s.desde))} · durou ${duracao(durou)}</dd>` +
    `<dt>Custo</dt><dd>${custo(s.custo)} · ${rotuloDoModelo(modeloDe(d, d.conversa))}</dd>` +
    `<dt>Mensagens</dt><dd>${String(mensagens(d).length)}</dd></dl>` +
    `<div class="trecho"><span class="quem">fim da conversa</span>${fim.length ? fim.map(pedaco).join("") : '<span class="muted">sem mensagens</span>'}</div>` +
    `<div class="botoes"><a class="btn btn-primario" href="${caminhoDaSessao(s.sessao)}">Abrir o chat</a>` +
    `<button type="button" class="btn" data-consulta="${String(s.ticket)}">Conversar sobre</button>` +
    `<a class="btn" href="/api/sessoes/${sessao}/historico.md" download>Exportar</a></div>`
  );
}

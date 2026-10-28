// Avaliações do SDLC (D12; I-240) como funções puras que devolvem HTML: o formulário de disparo, as demandas do período
// e a lista; no detalhe, a barra, o escopo, os achados, o envio e a conversa. O texto que vem do servidor passa sempre
// por `escapar`.
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { abrir, EstadoDaAvaliacao } from "../../../execucao/avaliacao.ts";
import type { Achado, ResumoAvaliacao } from "../../../persistencia/avaliacoes.ts";
import type { Entrada } from "../../rotas/chat.ts";
import { caminhoDaAvaliacao, caminhoDaDemanda, escapar, plural, rotuloDoModelo } from "../render.ts";
import { chaveDa, doSistema, type Envio, mensagem, type MensagemPi } from "./chat.ts";

/** A linha de `GET /api/avaliacoes`. */
export type AvaliacaoListada = ResumoAvaliacao & { achados: number; estado: EstadoDaAvaliacao };

const ESTADOS: Record<EstadoDaAvaliacao, [rotulo: string, pilula: string]> = {
  rodando: ["rodando", "pill-rodando"],
  concluida: ["concluída", "pill-ok"],
};

/** `2026-10-05` como `05/10/2026`. */
export const dataBr = (dia: string): string => dia.split("-").toReversed().join("/");

/** O formulário de disparo, com as caixinhas de demandas ainda vazias e a lista no fim. */
export function paginaDasAvaliacoes(projetos: readonly string[]): string {
  const opcoes = projetos.map((p) => `<option value="${escapar(p)}">${escapar(p)}</option>`).join("");
  return (
    `<div class="pagina-avaliacoes"><div class="cabeca-pagina"><h1>Avaliações</h1>` +
    `<span class="muted">melhorias do SDLC a partir das demandas de um período</span></div>` +
    `<form class="disparo superficie" data-form>` +
    `<label>Projeto <select data-projeto><option value="">escolha…</option>${opcoes}</select></label>` +
    `<label>De <input type="date" data-de></label><label>Até <input type="date" data-ate></label>` +
    `<fieldset class="demandas-do-periodo" data-demandas></fieldset>` +
    `<label class="pedido">Pedido <span class="muted">opcional; o que a avaliação deve investigar</span>` +
    `<textarea data-pedido rows="2" maxlength="4000" placeholder="Ex.: onde o desenho atrasa as demandas?"></textarea></label>` +
    `<div><button type="submit" class="btn btn-primario" data-avaliar>Avaliar</button></div></form>` +
    `<h2>Avaliações feitas</h2><div data-lista></div></div>`
  );
}

/** As demandas do período como caixinhas (todas desmarcadas: nenhuma marcada vale o período inteiro). */
export function caixinhasDeDemandas(demandas: readonly { id: string; titulo: string }[] | undefined): string {
  if (demandas === undefined)
    return '<legend>Demandas</legend><span class="muted">Escolha o projeto e o período.</span>';
  if (demandas.length === 0)
    return '<legend>Demandas</legend><span class="muted">Nenhuma demanda com sessão neste período.</span>';
  const itens = demandas.map(
    (d) =>
      `<label><input type="checkbox" value="${escapar(d.id)}" data-demanda> <span class="id">${escapar(d.id)}</span> ${escapar(d.titulo)}</label>`,
  );
  return `<legend>Demandas <span class="muted">opcional; nenhuma marcada avalia todas</span></legend>${itens.join("")}`;
}

/** A lista: uma linha por avaliação, com período, projeto, estado e número de achados; vira bloco no celular. */
export function listaDasAvaliacoes(lista: readonly AvaliacaoListada[]): string {
  if (lista.length === 0) return '<p class="muted">Nenhuma avaliação ainda.</p>';
  const linhas = lista.map(
    (a) =>
      `<a class="linha-avaliacao" href="${caminhoDaAvaliacao(a.id)}">` +
      `<span class="periodo">${dataBr(a.de)} a ${dataBr(a.ate)}</span><span class="projeto">${escapar(a.projeto)}</span>` +
      `<span><span class="pill ${ESTADOS[a.estado][1]}">${ESTADOS[a.estado][0]}</span></span>` +
      `<span class="num muted">${plural(a.achados, "achado", "achados")}</span></a>`,
  );
  return `<div class="lista-avaliacoes">${linhas.join("")}</div>`;
}

/** O que `GET /api/avaliacoes/:id` e o primeiro evento do SSE dão. */
export type DadosDaAvaliacao = Omit<ReturnType<typeof abrir>, "assinar">;

const DICA = '<span class="dica-tecla">Enter envia · Shift+Enter quebra linha</span>';

const etiquetaDoEstado = (estado: EstadoDaAvaliacao): string =>
  `<span class="pill ${ESTADOS[estado][1]}">${ESTADOS[estado][0]}</span>`;

/** Barra de estado: **Avaliação** e o projeto, o período, o estado, o modelo e o link da lista. */
export function barraDaAvaliacao(d: DadosDaAvaliacao, modelo: string): string {
  return (
    `<div class="estado-sessao"><span class="issue"><span class="id">Avaliação</span> ${escapar(d.projeto)}</span>` +
    `<span class="sep">│</span><span class="muted">${dataBr(d.de)} a ${dataBr(d.ate)}</span>` +
    `${etiquetaDoEstado(d.estado)}${rotuloDoModelo(modelo)}` +
    `<div class="direita"><a class="link" href="/evaluations">todas as avaliações</a></div></div>`
  );
}

/** O escopo: projeto, período, demandas (com link) e o pedido do Auditor, se houve. */
export function escopoDaAvaliacao(d: DadosDaAvaliacao): string {
  const demandas = d.demandas.map((id) => `<a class="id" href="${caminhoDaDemanda(id)}">${escapar(id)}</a>`).join(" ");
  return (
    `<section class="escopo superficie"><h3>Escopo</h3><dl class="fatos"><dt>Projeto</dt><dd>${escapar(d.projeto)}</dd>` +
    `<dt>Período</dt><dd>${dataBr(d.de)} a ${dataBr(d.ate)}</dd><dt>Demandas</dt><dd>${demandas}</dd>` +
    `${d.pedido ? `<dt>Pedido</dt><dd>${escapar(d.pedido)}</dd>` : ""}</dl></section>`
  );
}

/** Um achado: título, descrição, evidência e, no rodapé, o link da demanda criada ou o botão Encaminhar. */
export function cartaoDoAchado(a: Achado): string {
  const rodape = a.demanda_id
    ? `<a class="link" href="${caminhoDaDemanda(a.demanda_id)}">Demanda <span class="id">${escapar(a.demanda_id)}</span></a>`
    : `<button type="button" class="btn" data-encaminhar="${String(a.achado_id)}">Encaminhar como demanda</button>`;
  return (
    `<article class="achado superficie"><h3><span class="id">#${String(a.achado_id)}</span> ${escapar(a.titulo)}</h3>` +
    `<p>${escapar(a.descricao)}</p><p class="evidencia"><span class="muted">Evidência</span> ${escapar(a.evidencia)}</p>` +
    `<div class="rodape-achado">${rodape}</div></article>`
  );
}

/** Os achados em cartões; sem nenhum, a frase conforme o estado. */
export function achadosDaAvaliacao(d: DadosDaAvaliacao): string {
  const vazio = d.estado === "rodando" ? "O agente ainda não registrou achados." : "A avaliação não registrou achados.";
  return (
    `<section class="achados"><h2>Achados <span class="muted">${String(d.achados.length)}</span></h2>` +
    `${d.achados.length === 0 ? `<p class="muted">${vazio}</p>` : d.achados.map(cartaoDoAchado).join("")}</section>`
  );
}

/** Em conclusão, o compositor com Enviar; com o agente rodando, só Abortar. */
export function envioDaAvaliacao(estado: EstadoDaAvaliacao): Envio {
  if (estado === "rodando") {
    return {
      html:
        '<div class="fim">O agente está trabalhando; a pergunta fica para quando ele terminar.' +
        '<div class="botoes"><button type="button" class="btn btn-perigo" data-abortar>Abortar</button></div></div>',
    };
  }
  return {
    placeholder: "Pergunte sobre a avaliação",
    linha: `${DICA}<div class="direita"><button class="btn btn-primario">Enviar</button></div>`,
  };
}

/** A linha do sistema "Avaliação de … iniciada" no lugar do prompt montado pela Fabriquinha (`m`), e o pedido como balão. */
export const linhaDoInicioDaAvaliacao = (
  m: MensagemPi,
  d: Pick<DadosDaAvaliacao, "projeto" | "de" | "ate" | "pedido">,
): ThreadMessageLike[] => [
  doSistema({
    chave: chaveDa(m),
    html: `<div class="sistema">Avaliação de ${escapar(d.projeto)} (${dataBr(d.de)} a ${dataBr(d.ate)}) iniciada</div>`,
  }),
  ...(d.pedido
    ? [{ id: `${chaveDa(m)}-pedido`, role: "user" as const, content: [{ type: "text" as const, text: d.pedido }] }]
    : []),
];

/** A conversa do JSONL; o prompt marcado `fabriquinha` vira a linha do início. */
export function conversaDaAvaliacao(d: DadosDaAvaliacao): ThreadMessageLike[] {
  const mensagens = (d.conversa as Entrada[]).flatMap((e) =>
    e.type === "message" ? [{ m: e.message as MensagemPi, fabriquinha: e.fabriquinha === true }] : [],
  );
  const resultados = new Map(
    mensagens.filter(({ m }) => m.role === "toolResult").map(({ m }) => [String(m.toolCallId), m] as const),
  );
  return mensagens.flatMap(({ m, fabriquinha }) =>
    fabriquinha ? linhaDoInicioDaAvaliacao(m, d) : mensagem(m, resultados),
  );
}

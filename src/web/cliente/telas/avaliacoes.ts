// Avaliações do SDLC (D12; I-240) como funções puras que devolvem HTML: o formulário de disparo, as demandas do período
// e a lista. O texto que vem do servidor passa sempre por `escapar`.
import type { ResumoAvaliacao } from "../../../persistencia/avaliacoes.ts";
import type { EstadoDaAvaliacao } from "../../../execucao/avaliacao.ts";
import { caminhoDaAvaliacao, escapar, plural } from "../render.ts";

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

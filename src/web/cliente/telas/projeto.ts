// Página do projeto (F7 §4.4) como funções puras: o seletor, as abas e os cards do mês corrente. O DOM e a rede ficam
// em projeto-montar.ts.
import type { MetricasMesDemanda } from "../../../metricas/periodo_demanda.ts";
import { escapar } from "../render.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { cardsDoMes } from "./metricas.ts";

export const caminhoDoProjeto = (nome: string): string => `/projects/${encodeURIComponent(nome)}`;

/** O projeto de `/projects`: o último visto neste navegador, se ainda existe, ou o primeiro em ordem alfabética. */
export const escolherProjeto = (projetos: readonly ProjetoListado[], ultimo?: string): string | undefined =>
  projetos.find((p) => p.nome === ultimo)?.nome ?? projetos[0]?.nome;

export const SEM_PROJETOS =
  '<div class="cabeca-pagina"><h1>Projetos</h1></div><p class="muted">Nenhum projeto cadastrado ainda. <a class="link" href="/config?novo">Cadastrar um projeto na Configuração</a></p>';

export const projetoNaoEncontrado = (nome: string): string =>
  `<div class="cabeca-pagina"><h1>Projeto não encontrado</h1></div><p class="muted">O projeto ${escapar(nome)} não está cadastrado. <a class="link" href="/projects">Ver os projetos</a></p>`;

/** O seletor de projeto das duas abas; trocar de projeto leva à mesma aba do outro. */
export const seletor = (projetos: readonly ProjetoListado[], nome: string): string =>
  `<select class="seletor" aria-label="Projeto" data-projeto>${projetos
    .map((p) => `<option${p.nome === nome ? " selected" : ""}>${escapar(p.nome)}</option>`)
    .join("")}</select>`;

/** As abas da página do projeto: links de verdade, com a ativa marcada. */
export function abas(nome: string, ativa: "visao" | "heatmap"): string {
  const aba = (id: typeof ativa, href: string, rotulo: string) =>
    `<a href="${href}"${ativa === id ? ' aria-current="page"' : ""}>${rotulo}</a>`;
  const heatmap = `${caminhoDoProjeto(nome)}/heatmap`;
  return `<nav class="abas" aria-label="Abas do projeto">${aba("visao", caminhoDoProjeto(nome), "Visão geral")}${aba("heatmap", heatmap, "Heatmap")}</nav>`;
}

/** A página `/projects/:projeto`: o seletor, as abas e o mês corrente do projeto (`mes`) nos cards. */
export const paginaDoProjeto = (projetos: readonly ProjetoListado[], nome: string, mes: MetricasMesDemanda): string =>
  `<div class="seletor-linha"><h1>Projeto</h1>${seletor(projetos, nome)}<a class="editar" href="/config?projeto=${encodeURIComponent(nome)}">Editar na Configuração</a></div>${abas(nome, "visao")}${cardsDoMes(mes)}`;

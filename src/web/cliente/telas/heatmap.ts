// Aba Heatmap da página do projeto (F7 §4.4) como funções puras: o cabeçalho com a janela, a árvore de pastas e arquivos
// com a cor de calor e o detalhe de cada arquivo. Tudo o que vem do git passa por `escapar`. O DOM e a rede ficam em
// heatmap-montar.ts.
import type { CommitDoHeatmap, Heatmap, NoDoHeatmap } from "../../../repositorio/heatmap.ts";
import { diaMes, escapar, plural } from "../render.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { abas, caminhoDoProjeto, seletor } from "./projeto.ts";

/** Nó que se sabe pasta (tem `filhos`) ou arquivo (tem `commits`). */
type Pasta = NoDoHeatmap & { filhos: NoDoHeatmap[] };
type Arquivo = NoDoHeatmap & { commits: string[] };

export const caminhoDoHeatmap = (nome: string): string => `${caminhoDoProjeto(nome)}/heatmap`;

/** De 0 (sem alterações) a 1 (o total do projeto), em escala logarítmica: poucos arquivos quentes não apagam os demais. */
export const calor = (n: number, total: number): number => (total === 0 ? 0 : Math.log1p(n) / Math.log1p(total));

/** Do azul (frio) ao vermelho (quente), passando por verde e amarelo. */
export const cor = (c: number): string => `hsl(${String(220 * (1 - c))} 70% 50%)`;

const dia = (instante: string): string => `${diaMes(new Date(instante))}/${String(new Date(instante).getFullYear())}`;

/** O nó em `caminho` (nomes separados por `/`, a partir da raiz); o caminho vem das linhas desenhadas aqui. */
function achar(raiz: NoDoHeatmap, caminho: string): NoDoHeatmap {
  let no = raiz;
  for (const nome of caminho.split("/")) {
    for (const filho of (no as Pasta).filhos) if (filho.nome === nome) no = filho;
  }
  return no;
}

/** Uma linha por filho, cada um um `<details>`: o conteúdo entra na primeira abertura (`conteudo`). */
export function linhas(filhos: readonly NoDoHeatmap[], total: number, pai = ""): string {
  return filhos
    .map((no) => {
      const c = calor(no.alteracoes, total);
      const pasta = no.filhos !== undefined;
      const caminho = pai === "" ? no.nome : `${pai}/${no.nome}`;
      return `<details class="hm-no ${pasta ? "hm-pasta" : "hm-arquivo"}" data-caminho="${escapar(caminho)}"><summary class="hm-linha"><i class="hm-cor" style="background:${cor(c)}"></i><span class="hm-nome">${escapar(no.nome)}${pasta ? "/" : ""}</span><span class="hm-total">${String(no.alteracoes)}</span><span class="hm-barra"><i style="width:${String(100 * c)}%;background:${cor(c)}"></i></span></summary></details>`;
    })
    .join("");
}

function commit({ hash, mensagem, data, pr }: CommitDoHeatmap): string {
  const rotuloDoPr = pr === null ? "sem PR" : `PR #${escapar(pr)}`;
  return `<tr><td class="hm-hash">${escapar(hash.slice(0, 7))}</td><td>${escapar(mensagem)}</td><td class="hm-data">${dia(data)}</td><td class="hm-pr">${rotuloDoPr}</td></tr>`;
}

/** O que aparece ao abrir `caminho`: os filhos da pasta, ou o detalhe do arquivo com a métrica e os commits. */
export function conteudo(raiz: NoDoHeatmap, caminho: string, total: number, commits: Heatmap["commits"]): string {
  const no = achar(raiz, caminho);
  if (no.filhos !== undefined) return `<div class="hm-filhos">${linhas(no.filhos, total, caminho)}</div>`;
  const metrica = `<p class="hm-metrica"><strong>Código alterado: ${plural(no.alteracoes, "alteração", "alterações")}</strong> · quanto maior, pior</p>`;
  const alteracoes = (no as Arquivo).commits
    .map((hash) => commits[hash])
    .filter((c) => c !== undefined)
    .map(commit);
  return `<div class="hm-detalhe">${metrica}${
    alteracoes.length > 0
      ? `<table class="hm-commits"><thead><tr><th>Commit</th><th>Mensagem</th><th>Data</th><th>PR</th></tr></thead><tbody>${alteracoes.join("")}</tbody></table>`
      : ""
  }</div>`;
}

/** O seletor e as abas, com a Heatmap ativa: o topo de qualquer estado da aba. */
export const topoDoHeatmap = (projetos: readonly ProjetoListado[], nome: string): string =>
  `<div class="seletor-linha"><h1>Projeto</h1>${seletor(projetos, nome)}</div>${abas(nome, "heatmap")}`;

/** A aba `/projects/:projeto/heatmap`: o cabeçalho com a janela, a branch e o total, e a raiz do repositório. */
export function paginaDoHeatmap(projetos: readonly ProjetoListado[], nome: string, heatmap: Heatmap): string {
  const { branch, desde, ate, raiz } = heatmap;
  return `${topoDoHeatmap(projetos, nome)}
  <div class="hm-cabeca">
    <span>Janela <strong>${dia(desde)}</strong> a <strong>${dia(ate)}</strong></span>
    <span>branch <strong class="hm-branch">${escapar(branch)}</strong></span>
    <span><strong>${plural(raiz.alteracoes, "alteração", "alterações")}</strong> no projeto</span>
    <span class="hm-legenda">frio <i class="hm-frio"></i><i class="hm-morno"></i><i class="hm-quente"></i> quente</span>
  </div>
  ${raiz.alteracoes === 0 ? '<p class="muted">Nenhuma alteração nos últimos 12 meses</p>' : ""}
  <div class="hm-arvore" data-arvore>${linhas((raiz as Pasta).filhos, raiz.alteracoes)}</div>`;
}

/** O erro do git (repositório ou branch ausente) sob as abas, com o motivo e o que corrigir como o servidor os mandou. */
export const erroDoHeatmap = (projetos: readonly ProjetoListado[], nome: string, mensagem: string): string =>
  `${topoDoHeatmap(projetos, nome)}<div class="hm-erro" role="alert"><strong>Não foi possível montar o heatmap.</strong><p>${escapar(mensagem)}</p></div>`;

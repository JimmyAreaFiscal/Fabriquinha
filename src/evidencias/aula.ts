// Aula do código (F3 §4.5): o agente escreve a explicação de cada trecho; a Fabriquinha confere que o trecho é código
// alterado pela issue e gera o HTML com o código lido do git, nunca copiado pelo agente (princípio 2).
import type { Agregado } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { exigirGit } from "../repositorio/worktree.ts";
import { daUltimaConcluida } from "./schemas.ts";

export interface Trecho {
  arquivo: string;
  inicio: number;
  fim: number;
  oQueFaz: string;
  porQue: string;
  decisaoDoDesenho: string;
  alternativaDescartada?: string;
}

interface Alterado {
  caminho: string;
  status: string;
  adicionadas: number | null;
}

/** Um trecho com o código da `head` e as linhas dele que a issue adicionou ou mudou. */
interface TrechoLido extends Trecho {
  linhas: string[];
  mudadas: ReadonlySet<number>;
}

/** As linhas do lado novo que o diff `-U0` adicionou ou mudou, pelos cabeçalhos `@@ -a,b +c,d @@`. */
export function linhasMudadas(diff: string): Set<number> {
  const mudadas = new Set<number>();
  for (const [, inicio, quantas] of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const n = quantas === undefined ? 1 : Number(quantas);
    for (let i = 0; i < n; i++) mudadas.add(Number(inicio) + i);
  }
  return mudadas;
}

/** `1-3, 7, 9-12`: as faixas de linhas, para o agente achar um trecho válido. */
export function faixas(linhas: ReadonlySet<number>): string {
  const ordenadas = [...linhas].toSorted((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < ordenadas.length;) {
    let j = i;
    while (ordenadas[j + 1] === Number(ordenadas[j]) + 1) j++;
    partes.push(i === j ? String(ordenadas[i]) : `${String(ordenadas[i])}-${String(ordenadas[j])}`);
    i = j + 1;
  }
  return partes.join(", ");
}

const esc = (texto: string): string =>
  texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Lê cada trecho na `head` da última revisão e recusa o que não é código alterado pela issue. */
async function lerTrechos(ag: Agregado, worktree: string, trechos: readonly Trecho[]): Promise<TrechoLido[]> {
  const revisao = daUltimaConcluida(ag, "revisao", "arquivos_alterados");
  if (!revisao) {
    throw new ErroDeRegra("a issue não tem revisão concluída com arquivos_alterados", "a aula vem depois da revisão");
  }
  const { base, head, arquivos } = revisao.dados as unknown as { base: string; head: string; arquivos: Alterado[] };
  const lidos: TrechoLido[] = [];
  for (const trecho of trechos) {
    const local = `${trecho.arquivo}:${String(trecho.inicio)}-${String(trecho.fim)}`;
    const alterado = arquivos.find((a) => a.caminho === trecho.arquivo && a.status !== "D");
    if (!alterado) {
      throw new ErroDeRegra(
        `${trecho.arquivo} não é um arquivo criado ou alterado pela issue`,
        `escolha um da lista: ${arquivos.map((a) => a.caminho).join(", ")}`,
      );
    }
    if (alterado.adicionadas === null) {
      throw new ErroDeRegra(`${trecho.arquivo} é binário`, "explique arquivos binários na mensagem do PR");
    }
    const linhas = (await exigirGit(worktree, "show", `${head}:${trecho.arquivo}`)).replace(/\n$/, "").split("\n");
    if (trecho.fim > linhas.length) {
      throw new ErroDeRegra(
        `${local} passa do fim do arquivo`,
        `${trecho.arquivo} tem ${String(linhas.length)} linhas`,
      );
    }
    const mudadas = linhasMudadas(await exigirGit(worktree, "diff", "-U0", base, head, "--", trecho.arquivo));
    const toca = [...mudadas].some((n) => n >= trecho.inicio && n <= trecho.fim);
    if (!toca) {
      throw new ErroDeRegra(
        `${local} não toca nenhuma linha alterada pela issue`,
        `as linhas alteradas de ${trecho.arquivo} são ${faixas(mudadas)}`,
      );
    }
    lidos.push({ ...trecho, linhas: linhas.slice(trecho.inicio - 1, trecho.fim), mudadas });
  }
  return lidos;
}

function codigo({ linhas, inicio, mudadas }: TrechoLido): string {
  const corpo = linhas
    .map((texto, i) => {
      const n = inicio + i;
      const mudou = mudadas.has(n);
      return `<tr${mudou ? ' class="mudou"' : ""}><td class="n">${String(n)}</td><td class="m">${mudou ? "+" : ""}</td><td class="c">${esc(texto)}</td></tr>`;
    })
    .join("");
  return `<div class="codigo"><table>${corpo}</table></div>`;
}

function secao(t: TrechoLido, i: number): string {
  const item = (rotulo: string, texto: string | undefined) =>
    texto === undefined ? "" : `<dt>${rotulo}</dt><dd>${esc(texto)}</dd>`;
  const linhas = t.inicio === t.fim ? `linha ${String(t.inicio)}` : `linhas ${String(t.inicio)}–${String(t.fim)}`;
  return `<section id="t${String(i + 1)}">
<h2><span class="num">${String(i + 1)}</span><code>${esc(t.arquivo)}</code><span class="linhas">${linhas}</span></h2>
${codigo(t)}
<dl>${item("O que faz", t.oQueFaz)}${item("Por que assim", t.porQue)}${item("Decisão do desenho", t.decisaoDoDesenho)}${item("Alternativa descartada", t.alternativaDescartada)}</dl>
</section>`;
}

function html(ag: Agregado, trechos: readonly TrechoLido[]): string {
  const issue = `I-${String(ag.issue.id)}`;
  const titulo = ag.issue.titulo === null ? issue : `${issue}: ${esc(ag.issue.titulo)}`;
  const sumario = trechos
    .map((t, i) => `<li><a href="#t${String(i + 1)}"><code>${esc(t.arquivo)}</code></a> — ${esc(t.oQueFaz)}</li>`)
    .join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aula do código da ${issue}</title>
<style>
:root { --texto: #1f2328; --fraco: #59636e; --fundo: #fff; --caixa: #f6f8fa; --borda: #d0d7de; --mudou: #e6ffec; --marca: #1a7f37; }
@media (prefers-color-scheme: dark) { :root { --texto: #e6edf3; --fraco: #9198a1; --fundo: #0d1117; --caixa: #151b23; --borda: #3d444d; --mudou: #12261e; --marca: #3fb950; } }
body { font: 15px/1.55 system-ui, sans-serif; margin: 2rem auto; max-width: 64rem; padding: 0 1rem; color: var(--texto); background: var(--fundo); }
h1 { font-size: 1.5rem; margin-bottom: .25rem; }
.nota { color: var(--fraco); font-size: .9rem; margin-top: 0; }
ol.sumario { padding-left: 1.25rem; } ol.sumario a { color: inherit; }
section { margin-top: 2.5rem; }
h2 { font-size: 1.05rem; display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; }
.num { display: inline-grid; place-items: center; min-width: 1.6rem; height: 1.6rem; border-radius: 50%; background: var(--texto); color: var(--fundo); font-size: .85rem; }
.linhas { color: var(--fraco); font-weight: normal; font-size: .9rem; }
code, .codigo { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.codigo { overflow-x: auto; border: 1px solid var(--borda); border-radius: 6px; background: var(--caixa); font-size: 13px; line-height: 1.45; }
.codigo table { border-collapse: collapse; min-width: 100%; }
.codigo td { padding: 0 .6rem; white-space: pre; vertical-align: top; }
.codigo .n { color: var(--fraco); text-align: right; user-select: none; width: 1%; }
.codigo .m { color: var(--marca); user-select: none; width: 1%; padding: 0 .2rem; }
.codigo tr.mudou { background: var(--mudou); }
dl { display: grid; grid-template-columns: 11.5rem 1fr; gap: .4rem 1rem; margin: 1rem 0 0; }
dt { font-weight: 600; } dd { margin: 0; white-space: pre-wrap; }
@media (max-width: 40rem) { dl { grid-template-columns: 1fr; } dd { margin-bottom: .5rem; } }
</style>
</head>
<body>
<h1>Aula do código da ${titulo}</h1>
<p class="nota">Os trechos estão na ordem de leitura. O código vem do git; as linhas marcadas com + foram alteradas pela issue.</p>
<ol class="sumario">${sumario}</ol>
${trechos.map((t, i) => secao(t, i)).join("\n")}
</body>
</html>
`;
}

/**
 * F3 §4.5: confere cada trecho contra o diff da última revisão (`base..head` do `arquivos_alterados`) e devolve o HTML
 * da aula, que vira o anexo da evidência.
 */
export async function gerarAula(ag: Agregado, worktree: string, trechos: readonly Trecho[]): Promise<string> {
  return html(ag, await lerTrechos(ag, worktree, trechos));
}

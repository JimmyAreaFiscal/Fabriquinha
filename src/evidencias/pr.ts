// O Markdown dos PRs (F3 §4.6) e o limite da hospedagem (F3 §4.7): texto do agente e do Auditor neutralizado, listas,
// tabelas e números no formato pt-BR, montados só pela Fabriquinha.
import type { Hospedagem } from "../dominio/projeto.ts";
import markdownit from "markdown-it";

/** F3 §4.7: tamanho máximo do corpo em cada hospedagem, em caracteres. */
export const LIMITE_DO_CORPO: Readonly<Record<Hospedagem, number>> = { github: 65_536, "azure-devops": 4_000 };

const INTEIRO = new Intl.NumberFormat("pt-BR");
const DOLARES = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
export const inteiro = (n: number): string => INTEIRO.format(n);
export const dolares = (n: number): string => `US$ ${DOLARES.format(n)}`;

/**
 * Abertura ou fechamento de bloco de código cercado (CommonMark): três ou mais tis, ou três ou mais crases sem crase no
 * resto da linha (```a`b não abre bloco).
 */
const CERCA = /^ {0,3}(?:(`{3,})(?![^\n]*`)|(~{3,}))/;

/** Quantas crases seguidas começam em `i`. */
function crases(linha: string, i: number): number {
  let fim = i;
  while (linha.charAt(fim) === "`") fim += 1;
  return fim - i;
}

/** Onde começa, a partir de `de`, a próxima sequência de exatamente `n` crases, ou -1. */
function fechamento(linha: string, n: number, de: number): number {
  for (let i = linha.indexOf("`", de); i >= 0; i = linha.indexOf("`", i + crases(linha, i))) {
    if (crases(linha, i) === n) return i;
  }
  return -1;
}

/**
 * O `<` de uma linha fora de código inline vira `&lt;`. O código inline segue o CommonMark: crases que abrem fecham
 * com a próxima sequência de mesmo tamanho, e a crase escapada (`\``) não abre; dentro dele o `<` fica cru, porque o
 * GitHub e o Azure DevOps não decodificam entidade em código e o `&lt;` apareceria como está. Com `cru` falso, cada
 * `<` da linha vira `&lt;`.
 */
function semHtmlNaLinha(linha: string, cru: boolean): string {
  let saida = "";
  let i = 0;
  while (i < linha.length) {
    const c = linha.charAt(i);
    if (c === "\\") {
      // O caractere escapado sai como está: `\<` já não abre HTML, e `\`` não abre código.
      saida += linha.slice(i, i + 2);
      i += 2;
    } else if (c === "`") {
      const abre = crases(linha, i);
      const fim = cru ? fechamento(linha, abre, i + abre) : -1;
      const ate = fim < 0 ? i + abre : fim + abre;
      saida += linha.slice(i, ate);
      i = ate;
    } else {
      saida += c === "<" ? "&lt;" : c;
      i += 1;
    }
  }
  return saida;
}

/** Um título ATX do agente desce dois níveis (`## Uso` vira `#### Uso`), abaixo das seções `##` do PR. */
const TITULO = /^( {0,3})(#{1,6})(?=[ \t]|$)/;
/** O sublinhado de um título setext, que sai escapado. */
const SUBLINHADO = /^( {0,3})(=+[ \t]*$|-+[ \t]*$)/;

/** As linhas fora de bloco cercado neutralizadas, as de dentro como estão, e a cerca deixada aberta fechada no fim. */
function neutralizar(texto: string, cru: boolean): string {
  let cerca: string | undefined;
  const linhas: string[] = [];
  for (const linha of texto.trim().split("\n")) {
    const casou = CERCA.exec(linha);
    const marca = casou?.[1] ?? casou?.[2];
    if (cerca !== undefined) {
      if (marca?.startsWith(cerca.charAt(0)) && marca.length >= cerca.length && linha.trim() === marca) {
        cerca = undefined;
      }
      linhas.push(linha);
    } else if (marca === undefined) {
      linhas.push(
        semHtmlNaLinha(linha, cru)
          .replace(TITULO, (_, recuo: string, n: string) => recuo + "#".repeat(Math.min(n.length + 2, 6)))
          .replace(SUBLINHADO, String.raw`$1\$2`),
      );
    } else {
      cerca = marca;
      linhas.push(linha);
    }
  }
  return linhas.join("\n") + (cerca === undefined ? "" : `\n${cerca}`);
}

// html: true é preciso para o parser reconhecer HTML; o resultado nunca é renderizado.
const leitor = markdownit({ html: true }); // NOSONAR
/** Se o `markdown-it` (CommonMark, como o GitHub e o Azure DevOps) acha HTML no Markdown. */
const temHtml = (markdown: string): boolean =>
  leitor
    .parse(markdown, {})
    .some((t) => t.type === "html_block" || t.children?.some((f) => f.type === "html_inline") === true);

/**
 * Texto livre do agente ou do Auditor dentro do Markdown do PR, sem poder esconder nem imitar as seções geradas.
 * Fora de bloco cercado:
 * - cada `<` fora de código inline vira `&lt;`: comentário, `<details>` ou `<pre>` sem fechamento esconderiam ou
 *   transformariam o resto do corpo;
 * - um título desce dois níveis e uma linha só com `=`/`-` (o sublinhado de título) sai escapada, para um
 *   `## Evidências` no meio da mensagem não virar seção.
 * Dentro de bloco cercado a linha fica como o agente escreveu, e a cerca que ele deixou aberta é fechada no fim, para
 * o bloco não engolir o resto do corpo.
 * O código inline é reconhecido linha a linha; o parágrafo inteiro pode casar as crases de outro jeito (uma crase
 * aberta na linha de cima fecha na primeira desta) e deixar o `<` cru fora de código. Por isso o resultado passa pelo
 * `markdown-it`: se sobrou HTML, cada `<` fora de bloco cercado vira `&lt;`.
 * ponytail: a linha recuada em 4 espaços (bloco recuado) também fica.
 */
export function neutro(texto: string): string {
  const cru = neutralizar(texto, true);
  return temHtml(cru) ? neutralizar(texto, false) : cru;
}

/** Uma linha de item de lista: continuação recuada, para texto de várias linhas não sair da lista. */
const item = (texto: string): string => `- ${neutro(texto).replaceAll("\n", "\n  ")}`;
export const lista = (itens: readonly string[], vazio: string): string =>
  itens.length === 0 ? vazio : itens.map(item).join("\n");
export const tabela = (cabecalho: readonly string[], linhas: readonly (readonly string[])[]): string =>
  [cabecalho, cabecalho.map(() => "---"), ...linhas].map((l) => `| ${l.join(" | ")} |`).join("\n");
export const plural = (n: number, um: string, varios: string): string => `${inteiro(n)} ${n === 1 ? um : varios}`;
/** Texto em código inline. */
export const codigo = (texto: string): string => `\`${texto}\``;

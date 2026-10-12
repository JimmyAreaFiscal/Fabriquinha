// Título e corpo do PR (F3 §4.6) e a condensação ao limite da hospedagem (F3 §4.7). Markdown montado só pela
// Fabriquinha, a partir das evidências já validadas da issue; o agente escreve só a `mensagem_pr`.
import type { Agregado, Evidencia, Issue, TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Etapa, Id } from "../dominio/primitivos.ts";
import type { Hospedagem } from "../dominio/projeto.ts";
import type { MetricasIssue } from "../metricas/issue.ts";
import { dolares, duracao, inteiro, tokens } from "../metricas/relatorio.ts";
import { linhas, resultado } from "./formato.ts";
import { daUltimaConcluida } from "./schemas.ts";

/** F3 §4.7: tamanho máximo do corpo em cada hospedagem, em caracteres. */
export const LIMITE_DO_CORPO: Readonly<Record<Hospedagem, number>> = { github: 65_536, "azure-devops": 4_000 };

// Os formatos vêm dos schemas do F3, validados na submissão ou na coleta.
interface MensagemPR {
  titulo: string;
  oQueMudou: string;
  decisoesNaoObvias: string[];
  naoFeito: string[];
  naoPrevistos: { caminho: string; motivo: string }[];
  comoRevisar: string[];
  naoVerificado: string[];
  reversao?: string;
}
interface Rodado {
  comando: string;
  codigoSaida: number | null;
  estourou: boolean;
  duracaoMs: number;
}
interface Alterado {
  caminho: string;
  status: string;
  adicionadas: number | null;
  removidas: number | null;
  previsto: string | null;
}
interface Sonar {
  arquivosAnalisados: string[];
  issues: { arquivo: string; linha?: number; regra: string; severidade: string; mensagem: string }[];
}
interface Criterio {
  id: string;
  atendido: boolean;
  comoVerificado: string;
  arquivos: string[];
}
type Complexidade = Record<"tempo" | "espaco", string>;
interface Fluxo {
  nome: string;
  situacao: string;
  antes?: Complexidade;
  depois: Complexidade;
}
interface Impactos {
  impacto: string;
  riscos: { descricao: string; mitigacao: string }[];
}

/** F3 §4.6: `<feat|fix>: <titulo> [I-<n>]`, com `feat` para funcionalidade e `fix` para problema. */
export const tituloDoPR = (issue: Pick<Issue, "id" | "tipo">, titulo: string): string =>
  `${issue.tipo === "funcionalidade" ? "feat" : "fix"}: ${titulo} [I-${String(issue.id)}]`;

/**
 * A marca, invisível no Markdown renderizado, que identifica o PR publicado pelo ticket de encerramento. Com ela, o
 * PR criado por uma execução cujo registro de `pr_aberto` falhou é reconhecido como da Fabriquinha (F5 §5.0).
 */
export const marcaDoPR = (issue: Id, ticket: Id): string =>
  `<!-- fabriquinha I-${String(issue)}/T-${String(ticket)} -->`;

/**
 * Abertura ou fechamento de bloco de código cercado (CommonMark): três ou mais tis, ou três ou mais crases sem crase no
 * resto da linha (```a`b não abre bloco).
 */
const CERCA = /^ {0,3}(?:(`{3,})(?![^\n]*`)|(~{3,}))/;

/**
 * Texto livre do agente ou do Auditor dentro do Markdown do PR, sem poder esconder nem imitar as seções geradas.
 * Fora de bloco cercado:
 * - cada `<` vira `&lt;`: comentário, `<details>` ou `<pre>` sem fechamento esconderiam ou transformariam o resto do
 *   corpo;
 * - uma linha com `#` ou só com `=`/`-` (o sublinhado de título) sai escapada, para um `## Evidências` no meio da
 *   mensagem não virar seção.
 * Dentro de bloco cercado a linha fica como o agente escreveu, e a cerca que ele deixou aberta é fechada no fim, para
 * o bloco não engolir o resto do corpo.
 * ponytail: o `<` dentro de código inline também vira `&lt;` e aparece assim no PR. Reconhecer código inline como o
 * CommonMark (crases de mesmo tamanho, crase escapada) é onde o HTML do agente escapava; se o cosmético pesar, usar
 * um parser de Markdown de verdade.
 * ponytail: a linha recuada em 4 espaços (bloco recuado) também fica.
 */
function neutro(texto: string): string {
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
      linhas.push(linha.replaceAll("<", "&lt;").replace(/^( {0,3})(#|=+[ \t]*$|-+[ \t]*$)/, String.raw`$1\$2`));
    } else {
      cerca = marca;
      linhas.push(linha);
    }
  }
  return linhas.join("\n") + (cerca === undefined ? "" : `\n${cerca}`);
}

/** Uma linha de item de lista: continuação recuada, para texto de várias linhas não sair da lista. */
const item = (texto: string): string => `- ${neutro(texto).replaceAll("\n", "\n  ")}`;
const lista = (itens: readonly string[], vazio: string): string =>
  itens.length === 0 ? vazio : itens.map(item).join("\n");
/** Célula de tabela Markdown: uma linha só, sem `|` que abra outra coluna. */
const celula = (texto: string): string =>
  neutro(texto)
    // O pipe só fica escapado atrás de um número ímpar de barras: o `\|` do agente já está escapado, e `\\|` seria
    // uma barra literal seguida de um pipe que divide a coluna.
    .replaceAll(/\\*\|/g, (pipe) => (pipe.length % 2 === 0 ? pipe : `\\${pipe}`))
    .replaceAll(/\s*\n\s*/g, " ");
const tabela = (cabecalho: readonly string[], linhas: readonly (readonly string[])[]): string =>
  [cabecalho, cabecalho.map(() => "---"), ...linhas].map((l) => `| ${l.join(" | ")} |`).join("\n");
const plural = (n: number, um: string, varios: string): string => `${inteiro(n)} ${n === 1 ? um : varios}`;
/** Texto em código inline. */
const codigo = (texto: string): string => `\`${texto}\``;
function issueDoSonar(i: Sonar["issues"][number]): string {
  const onde = i.linha === undefined ? i.arquivo : `${i.arquivo}:${String(i.linha)}`;
  return `${codigo(onde)} ${i.regra} (${i.severidade}): ${i.mensagem}`;
}
/** Como o PR cita um anexo que fica na Fabriquinha (F3 §4.6). */
const citar = (issue: Id, e: Evidencia, nome: string): string => `I-${String(issue)} · ${e.tipo} · ${nome}`;

/** O título e as seções na ordem do F3 §4.6, com a versão completa e, nas que o §4.7 condensa, a condensada. */
function secoes(
  ag: Agregado,
  ticket: Id,
): { titulo: string; secoes: { titulo: string; texto: string; condensado?: string }[] } {
  const issue = ag.issue;
  const exigir = (etapa: Etapa, tipo: TipoEvidencia): Evidencia => {
    const e =
      etapa === "encerramento"
        ? ag.evidencias.find((x) => x.ticket === ticket && x.tipo === tipo)
        : daUltimaConcluida(ag, etapa, tipo);
    if (!e) {
      throw new ErroDeRegra(
        `o PR da I-${String(issue.id)} não pode ser montado: falta a evidência ${tipo} da etapa ${etapa}`,
        "o PR sai das evidências do desenho aprovado, do último desenvolvimento, da última revisão e do encerramento",
      );
    }
    return e;
  };
  const dados = (etapa: Etapa, tipo: TipoEvidencia): unknown => exigir(etapa, tipo).dados;

  const m = dados("encerramento", "mensagem_pr") as MensagemPR;
  const metricas = dados("encerramento", "relatorio_produtividade") as MetricasIssue;
  const { foraDeEscopo } = dados("desenho", "desenho_solucao") as { foraDeEscopo: string[] };
  const { fluxos } = dados("desenho", "relatorio_complexidade") as { fluxos: Fluxo[] };
  const impactos = dados("desenho", "relatorio_impactos_arquitetura") as Impactos;
  const { arquivos } = dados("revisao", "arquivos_alterados") as { arquivos: Alterado[] };
  const { comandos } = dados("desenvolvimento", "execucao_testes") as { comandos: Rodado[] };
  const sonar = dados("desenvolvimento", "relatorio_sonar") as Sonar;
  const fitness = (dados("revisao", "matriz_fitness") as { linhas: (Rodado & { nome: string })[] }).linhas;
  const explicacoes = dados("revisao", "explicacao_fitness") as { explicacoes: { nome: string; explicacao: string }[] };
  const comprovacao = exigir("revisao", "comprovacao_criterios");
  const { criterios } = comprovacao.dados as unknown as { criterios: Criterio[] };

  const motivo = new Map(m.naoPrevistos.map((n) => [n.caminho, n.motivo]));
  const naoPrevistos = arquivos.filter((a) => a.previsto === null);
  const passaram = <T>(itens: readonly T[], passou: (i: T) => boolean) =>
    `${String(itens.filter(passou).length)}/${String(itens.length)}${itens.every(passou) ? " ✓" : " ✗"}`;
  const ok = (r: Rodado) => r.codigoSaida === 0;
  const explicacao = new Map(explicacoes.explicacoes.map((e) => [e.nome, e.explicacao]));
  const complexidade = (f: Fluxo, medida: keyof Complexidade) =>
    f.antes ? `${f.antes[medida]} → ${f.depois[medida]}` : f.depois[medida];
  const doDesenho = (
    ["desenho_solucao", "prototipo", "relatorio_complexidade", "relatorio_impactos_arquitetura"] as const
  )
    .map((tipo) => daUltimaConcluida(ag, "desenho", tipo))
    .filter((e) => e !== undefined);
  const naFabriquinha = [
    ...doDesenho,
    exigir("encerramento", "video_explicativo"),
    exigir("encerramento", "relatorio_produtividade"),
  ].flatMap((e) => e.arquivos.map((a) => citar(issue.id, e, a.nome)));
  const etapas = metricas.etapas;
  const soma = (campo: "execucoes" | "reprovacoes" | "custo") => etapas.reduce((n, e) => n + e[campo], 0);
  const autoria = "Produzido por agentes pi na Fabriquinha";

  return {
    titulo: tituloDoPR(issue, m.titulo),
    secoes: [
      {
        titulo: "Por quê",
        texto: `**${issue.tipo === "funcionalidade" ? "Funcionalidade" : "Problema"}:** ${neutro(String(issue.titulo))}\n\n${neutro(issue.descricao)}`,
      },
      { titulo: "O que mudou", texto: neutro(m.oQueMudou) },
      { titulo: "Decisões não óbvias", texto: lista(m.decisoesNaoObvias, "Nenhuma.") },
      { titulo: "Fora do escopo", texto: lista([...foraDeEscopo, ...m.naoFeito], "Nada declarado.") },
      {
        titulo: "Arquivos alterados × desenho",
        texto: tabela(
          ["Arquivo", "Status", "Linhas", "Desenho"],
          arquivos.map((a) => [
            celula(`\`${a.caminho}\``),
            a.status,
            linhas(a),
            celula(a.previsto === null ? `não previsto: ${String(motivo.get(a.caminho))}` : `\`${a.previsto}\``),
          ]),
        ),
        condensado: [
          `${plural(arquivos.length - naoPrevistos.length, "previsto", "previstos")}, ` +
            `${plural(naoPrevistos.length, "não previsto", "não previstos")}.`,
          ...naoPrevistos.map((a) => item(`\`${a.caminho}\`: ${String(motivo.get(a.caminho))}`)),
        ].join("\n\n"),
      },
      {
        titulo: "Como revisar",
        texto: m.comoRevisar.map((p, i) => `${String(i + 1)}. ${neutro(p).replaceAll("\n", "\n   ")}`).join("\n"),
      },
      {
        titulo: "Evidências",
        texto: [
          `**Testes**\n\n${lista(
            comandos.map((c) => `\`${c.comando}\`: ${resultado(c)} em ${duracao(c.duracaoMs)}`),
            "",
          )}`,
          `**SonarQube**: ${plural(sonar.issues.length, "issue", "issues")} em ` +
            `${plural(sonar.arquivosAnalisados.length, "arquivo analisado", "arquivos analisados")}: ` +
            `${sonar.arquivosAnalisados.map(codigo).join(", ")}.` +
            (sonar.issues.length === 0 ? "" : `\n\n${lista(sonar.issues.map(issueDoSonar), "")}`),
          `**Fitness functions**\n\n${lista(
            fitness.map((l) => `**${l.nome}**: ${resultado(l)}. ${String(explicacao.get(l.nome))}`),
            "",
          )}`,
          `**Critérios de aceite**\n\n${lista(
            criterios.map(
              (c) =>
                `**${c.id}** ${c.atendido ? "atendido ✓" : "não atendido ✗"}: ${c.comoVerificado} ` +
                `(${c.arquivos.map((nome) => citar(issue.id, comprovacao, nome)).join("; ")})`,
            ),
            "",
          )}`,
          `**Complexidade**\n\n${lista(
            fluxos.map(
              (f) =>
                `**${f.nome}** (${f.situacao}): tempo ${complexidade(f, "tempo")}, espaço ${complexidade(f, "espaco")}`,
            ),
            "Nenhum fluxo executável.",
          )}`,
          `**Na Fabriquinha**\n\n${lista(naFabriquinha, "")}`,
        ].join("\n\n"),
        condensado: lista(
          [
            `Testes ${passaram(comandos, ok)}`,
            `SonarQube ${plural(sonar.issues.length, "issue", "issues")} em ${plural(sonar.arquivosAnalisados.length, "arquivo", "arquivos")}`,
            `Fitness ${passaram(fitness, ok)}`,
            `Critérios ${String(criterios.filter((c) => c.atendido).length)}/${String(criterios.length)}`,
            `Complexidade: ${plural(fluxos.length, "fluxo", "fluxos")}`,
          ],
          "",
        ),
      },
      { titulo: "Não verificado", texto: lista(m.naoVerificado, "Nada.") },
      {
        titulo: "Riscos e reversão",
        texto: [
          `**Impacto na arquitetura:** ${impactos.impacto}`,
          lista(
            impactos.riscos.map((r) => `**Risco:** ${r.descricao} **Mitigação:** ${r.mitigacao}`),
            "Nenhum risco declarado.",
          ),
          ...(m.reversao === undefined ? [] : [`**Reversão:** ${neutro(m.reversao)}`]),
        ].join("\n\n"),
      },
      {
        titulo: "Autoria e custo",
        texto: `${autoria}.\n\n${tabela(
          ["Etapa", "Modelos", "Execuções", "Tokens", "Custo", "Reprovações"],
          etapas.map((e) => [
            e.etapa,
            celula(e.modelos.map((x) => `${x.provedor}/${x.modelo}`).join(", ") || "—"),
            inteiro(e.execucoes),
            inteiro(tokens(e)),
            dolares(e.custo),
            inteiro(e.reprovacoes),
          ]),
        )}`,
        condensado:
          `${autoria}: ${plural(soma("execucoes"), "execução", "execuções")}, ` +
          `${inteiro(etapas.reduce((n, e) => n + tokens(e), 0))} tokens, ${dolares(soma("custo"))}, ` +
          `${plural(soma("reprovacoes"), "reprovação", "reprovações")}.`,
      },
    ],
  };
}

/**
 * F3 §4.6 e §4.7: o título, o corpo completo do PR do ticket de encerramento `ticket` e o publicado, que cabe em
 * `limite` caracteres. Condensa nesta ordem e para assim que couber: seção 5, seção 7, seção 10 e, por fim, corta o fim. Só as
 * seções geradas pela Fabriquinha são condensadas; as do agente só perdem o fim no corte.
 */
export function montarPR(
  ag: Agregado,
  ticket: Id,
  limite: number,
): { titulo: string; completo: string; publicado: string; condensado: boolean } {
  const { titulo, secoes: todas } = secoes(ag, ticket);
  const condensaveis = todas.filter((s) => s.condensado !== undefined);
  /** O corpo com as `n` primeiras seções condensáveis condensadas. */
  const montar = (n: number) =>
    [
      marcaDoPR(ag.issue.id, ticket),
      ...todas.map((s) => {
        const i = condensaveis.indexOf(s);
        return `## ${s.titulo}\n\n${(i >= 0 && i < n ? String(s.condensado) : s.texto).trim()}`;
      }),
    ].join("\n\n") + "\n";
  const completo = montar(0);
  for (let n = 0; n <= condensaveis.length; n++) {
    const corpo = montar(n);
    if (corpo.length <= limite) return { titulo, completo, publicado: corpo, condensado: n > 0 };
  }
  const fim = `\n\n… corpo completo em I-${String(ag.issue.id)}, evidência pr_aberto\n`;
  // Não deixa meio par de surrogates no fim do corte.
  const cortado = montar(condensaveis.length)
    .slice(0, limite - fim.length)
    .replace(/[\uD800-\uDBFF]$/, "");
  return { titulo, completo, publicado: cortado + fim, condensado: true };
}

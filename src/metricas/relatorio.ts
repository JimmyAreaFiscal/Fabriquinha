// Relatório de produtividade do SDLC de uma issue (F6 §6): recoleta, monta `MetricasIssue` e gera o HTML autocontido.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import { commitDoTicket } from "../persistencia/commits.ts";
import { noLog } from "../persistencia/execucoes.ts";
import { agregado } from "../persistencia/issues.ts";
import { type Consumo, type MetricasIssue, metricasDaIssue, somar } from "./issue.ts";
import { registrarRetrabalho } from "./retrabalho.ts";
import { depoisDoC6 } from "./uso.ts";

/** Texto do banco (títulos, motivos, modelos) dentro do HTML: o agente e o Auditor escrevem o que quiserem nele. */
const esc = (texto: string): string =>
  texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const INTEIRO = new Intl.NumberFormat("pt-BR");
const DOLARES = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
export const inteiro = (n: number): string => INTEIRO.format(n);
export const dolares = (n: number): string => `US$ ${DOLARES.format(n)}`;
export const tokens = (c: Consumo): number =>
  c.tokens.input + c.tokens.output + c.tokens.cacheRead + c.tokens.cacheWrite;

/** `1h 02min`, `3min 07s` ou `12s`. */
export function duracao(ms: number): string {
  const s = Math.round(ms / 1000);
  const [h, min, seg] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const dois = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${String(h)}h ${dois(min)}min`;
  return min > 0 ? `${String(min)}min ${dois(seg)}s` : `${String(seg)}s`;
}

const celulas = (tag: "th" | "td", conteudos: readonly string[]): string =>
  conteudos.map((c) => `<${tag}>${c}</${tag}>`).join("");

/** Uma tabela; as células já vêm escapadas. */
function tabela(cabecalho: readonly string[], linhas: readonly (readonly string[])[]): string {
  const corpo = linhas.map((l) => `<tr>${celulas("td", l)}</tr>`).join("");
  return `<table><thead><tr>${celulas("th", cabecalho)}</tr></thead><tbody>${corpo}</tbody></table>`;
}

const secao = (titulo: string, corpo: string): string => `<section><h2>${titulo}</h2>${corpo}</section>`;

/** F6 §6.3: o HTML autocontido, com as seis seções na ordem; `titulo` é o da issue, ainda nulo no registro. */
function html(d: MetricasIssue, titulo: string | null): string {
  const total = somar([...d.etapas, d.consultas]);
  const soma = (campo: "execucoes" | "falhas" | "duracaoMs") => d.etapas.reduce((n, e) => n + e[campo], 0);
  const linhasAlteradas = d.retrabalho.reduce((n, r) => n + r.linhasAlteradasDepois, 0);
  const porHumanos = d.retrabalho.reduce((n, r) => n + r.linhasAlteradasPorHumanos, 0);
  const adicionadas = d.retrabalho.reduce((n, r) => n + r.linhasAdicionadas, 0);
  const correcoes = (c: MetricasIssue["correcoesRegistro"]) =>
    `${inteiro(c.devolucoes + c.ajustesAuditor)} (devoluções: ${inteiro(c.devolucoes)}, ajustes: ${inteiro(c.ajustesAuditor)})`;
  const modelos = [
    ...d.etapas.flatMap((e) => e.modelos.map((m) => ({ etapa: e.etapa, ...m }))),
    ...d.consultas.modelos.map((m) => ({ etapa: "consultas", ...m })),
  ];
  const rotulo = `I-${String(d.issue)}`;
  const cabecalho = titulo === null ? rotulo : `${rotulo}: ${esc(titulo)}`;
  const semSessao = d.execucoesSemSessao.map((e) => `E-${String(e)}`).join(", ");

  const secoes = [
    secao(
      "Resumo",
      tabela(
        ["Custo total", "Tokens totais", "Duração", "Execuções", "Falhas"],
        // Custo e tokens somam as consultas; execuções, duração e falhas são das etapas, como na tabela por etapa.
        [
          [
            dolares(total.custo),
            inteiro(tokens(total)),
            duracao(soma("duracaoMs")),
            inteiro(soma("execucoes")),
            inteiro(soma("falhas")),
          ],
        ],
      ),
    ),
    secao(
      "Por etapa",
      tabela(
        ["Etapa", "Execuções", "Falhas", "Duração", "Reprovações", "Tokens", "Custo"],
        [
          ...d.etapas.map((e) => [
            esc(e.etapa),
            inteiro(e.execucoes),
            inteiro(e.falhas),
            duracao(e.duracaoMs),
            inteiro(e.reprovacoes),
            inteiro(tokens(e)),
            dolares(e.custo),
          ]),
          [
            "consultas",
            inteiro(d.consultas.execucoes),
            "—",
            "—",
            "—",
            inteiro(tokens(d.consultas)),
            dolares(d.consultas.custo),
          ],
        ],
      ),
    ),
    secao(
      "Por modelo",
      modelos.length === 0
        ? "<p>Nenhuma chamada de modelo registrada.</p>"
        : tabela(
            ["Etapa", "Modelo", "Chamadas", "Input", "Output", "Cache read", "Cache write", "Custo"],
            modelos.map((m) => [
              esc(m.etapa),
              esc(`${m.provedor}/${m.modelo}`),
              inteiro(m.chamadas),
              inteiro(m.tokens.input),
              inteiro(m.tokens.output),
              inteiro(m.tokens.cacheRead),
              inteiro(m.tokens.cacheWrite),
              dolares(m.custo),
            ]),
          ),
    ),
    secao(
      "Métricas do diagrama",
      tabela(
        ["#", "Métrica", "Valor", "Definição"],
        [
          [
            "M2",
            "Correções do Auditor",
            correcoes(d.correcoesRegistro),
            "Devoluções no gate de registro + ajustes do Auditor na issue durante o registro.",
          ],
          [
            "M3",
            "Correções no desenho",
            correcoes(d.correcoesDesenho),
            "Reprovações no gate de desenho + ajustes do Auditor nos tickets propostos.",
          ],
          [
            "M4",
            "Alterações posteriores no código",
            `${inteiro(linhasAlteradas)} de ${inteiro(adicionadas)} linhas (${inteiro(porHumanos)} por humanos)`,
            "Linhas escritas pelos tickets e depois removidas ou reescritas por outro ticket ou por commit humano na base.",
          ],
          [
            "M5",
            "Exigências de alteração",
            inteiro(d.exigenciasRevisao),
            "Tickets de desenvolvimento criados pela revisão.",
          ],
          [
            "M6",
            "Bugs em arquivos revisados",
            inteiro(d.bugsEmArquivosRevisados),
            "Issues de problema registradas depois do merge que alteraram arquivo alterado por esta issue.",
          ],
          [
            "M7",
            "Feedback humano da qualidade",
            d.notaPR === null ? "—" : `${String(d.notaPR)} de 5`,
            "Nota dada pelo Auditor ao encerrar a issue.",
          ],
        ],
      ),
    ),
    secao(
      "Decisões",
      d.decisoes.length === 0
        ? "<p>Nenhuma decisão registrada.</p>"
        : tabela(
            ["Gate", "Resultado", "Motivo", "Nota", "Em"],
            d.decisoes.map((x) => [
              esc(x.gate),
              x.aprovado ? "aprovado" : "reprovado",
              esc(x.motivo ?? "—"),
              x.nota === undefined ? "—" : String(x.nota),
              esc(x.em),
            ]),
          ),
    ),
    secao(
      "Avisos",
      d.execucoesSemSessao.length === 0
        ? "<p>Nenhum aviso.</p>"
        : `<p>Execuções com a sessão do pi ausente ou repetida, fora das contas de tokens e custo: ${semSessao}.</p>`,
    ),
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Produtividade da ${rotulo}</title>
<style>
body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 70rem; padding: 0 1rem; color: #1f2328; background: #fff; }
h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
table { border-collapse: collapse; width: 100%; } th, td { border-bottom: 1px solid #d0d7de; padding: .35rem .6rem; text-align: left; }
th { background: #f6f8fa; } td:not(:first-child) { font-variant-numeric: tabular-nums; }
section { overflow-x: auto; }
.nota { color: #59636e; font-size: .9rem; }
</style>
</head>
<body>
<h1>Produtividade da ${cabecalho}</h1>
<p class="nota">Gerado em ${esc(d.geradoEm)}. Uma fotografia: a nota do PR e os bugs posteriores podem não existir ainda.</p>
${secoes.join("\n")}
</body>
</html>
`;
}

/**
 * F6 §6.1: recoleta o uso das execuções terminadas da issue e refaz o retrabalho dos seus tickets de desenvolvimento,
 * depois monta as métricas e o HTML. Falha na recoleta só vai para o log (o da execução, no uso; o do serviço, no
 * retrabalho): métrica nunca para o fluxo, e o relatório sai com o que já estava gravado.
 */
export async function relatorio(banco: DatabaseSync, issue: Id): Promise<{ dados: MetricasIssue; html: string }> {
  const ag = agregado(banco, issue);
  if (!ag) throw new ErroDeRegra(`a issue I-${String(issue)} não existe`, "confira o número da issue");
  for (const e of ag.execucoes) if (e.terminadaEm !== undefined) depoisDoC6(banco, e.id);
  for (const t of ag.tickets) {
    const sha = t.etapa === "desenvolvimento" ? commitDoTicket(banco, t.id) : undefined;
    if (sha === undefined) continue;
    try {
      await registrarRetrabalho(banco, t.id, sha);
    } catch (error_) {
      noLog(`I-${String(issue)}: retrabalho de T-${String(t.id)} falhou no relatório: ${String(error_)}`);
    }
  }
  const dados = metricasDaIssue(banco, issue);
  return { dados, html: html(dados, ag.issue.titulo) };
}

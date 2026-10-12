// Histórico como contexto (F4 §6.8): a conversa de uma sessão em Markdown, gerada do JSONL do pi, e o anexo dela
// a uma mensagem de outra sessão.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../dominio/erros.ts";
import type { Agregado } from "../dominio/agregado.ts";
import { naSessaoPrincipal, ticketDe } from "../dominio/execucao.ts";
import type { Id } from "../dominio/primitivos.ts";
import { raizDo } from "../persistencia/banco.ts";
import { dirDaExecucao, issueDaSessao } from "../persistencia/execucoes.ts";
import { agregado } from "../persistencia/issues.ts";
import { type InfoSessao, infoDaSessao, lerConversa } from "./sessoes.ts";

/** ponytail: o corte é fixo (F4 §6.8); se algum resultado longo fizer falta, aumentar o limite. */
const CORTE = 2000;

interface Bloco {
  type?: string;
  text?: string;
  name?: string;
  arguments?: unknown;
}

/** A parte de uma mensagem do pi que o histórico mostra (formato da sessão do pi). */
export interface Mensagem {
  role?: string;
  content: string | Bloco[];
  toolName?: string;
  isError?: boolean;
  provider?: string;
  model?: string;
}

const blocos = (m: Mensagem): Bloco[] =>
  typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;

/** O texto da mensagem; imagens e raciocínio ficam de fora. */
export const texto = (m: Mensagem): string =>
  blocos(m)
    .filter((b) => b.type === "text")
    .map((b) => String(b.text))
    .join("\n");

/** Bloco de código com uma cerca maior que qualquer sequência de crases do conteúdo, para ele não fechá-la. */
function cerca(conteudo: string, lingua = ""): string {
  const crases = "`".repeat(Math.max(2, ...(conteudo.match(/`+/g) ?? []).map((c) => c.length)) + 1);
  return `${crases}${lingua}\n${conteudo}\n${crases}`;
}

const cortar = (t: string): string =>
  t.length <= CORTE ? t : `${t.slice(0, CORTE)}\n… (cortado em ${String(CORTE)} de ${String(t.length)} caracteres)`;

/**
 * Os prompts que a Fabriquinha montou (F4 §6.3) na sessão principal do ticket, que a consulta também copia: o da
 * primeira execução e os das autônomas. Os das retomadas interativas são a mensagem do Auditor.
 */
export function promptsDaFabriquinha(raiz: string, ag: Agregado, ticket: Id): Set<string> {
  const prompts = ag.execucoes
    .filter(naSessaoPrincipal(ticket))
    .filter((e, i) => i === 0 || e.modo === "autonomo")
    .map((e) => join(dirDaExecucao(raiz, e.id), "prompt.md"));
  return new Set(prompts.filter((p) => existsSync(p)).map((p) => readFileSync(p, "utf8")));
}

/** Uma mensagem em Markdown: Fabriquinha, Auditor e agente na íntegra, chamadas e resultados cortados. */
function emMarkdown(m: Mensagem, daFabriquinha: Set<string>): string[] {
  if (m.role === "user") return [`## ${daFabriquinha.has(texto(m)) ? "Fabriquinha" : "Auditor"}\n\n${texto(m)}`];
  if (m.role === "toolResult") {
    const erro = m.isError ? " (erro)" : "";
    return [`**Resultado de \`${String(m.toolName)}\`${erro}**\n\n${cerca(cortar(texto(m)))}`];
  }
  if (m.role !== "assistant") return [];
  const chamadas = blocos(m).filter((b) => b.type === "toolCall");
  return [
    `## Agente\n\n${texto(m)}`.trimEnd(),
    ...chamadas.map(
      (c) => `**Chamada de \`${String(c.name)}\`**\n\n${cerca(JSON.stringify(c.arguments ?? {}, null, 2), "json")}`,
    ),
  ];
}

/**
 * F4 §6.8: a conversa da sessão em Markdown, com cabeçalho (projeto, issue, ticket, etapa, modelos e datas), as
 * mensagens do Auditor e do agente na íntegra, cada chamada de ferramenta com os argumentos e os resultados cortados.
 * ponytail: segue a ordem do arquivo, sem a árvore de ramos do pi (as sessões da Fabriquinha não ramificam), e deixa
 * de fora as mensagens que não são do Auditor, do agente nem de ferramenta (extensão, resumo de compactação, `bash`
 * do usuário); mostrá-las se fizerem falta.
 */
export function exportarHistorico(banco: DatabaseSync, sessao: string): string {
  const erro = [`a sessão ${sessao} não existe`, "confira o endereço do chat"] as const;
  const ag = encontrado(agregado(banco, encontrado(issueDaSessao(banco, sessao), ...erro)), ...erro);
  const execucoes = ag.execucoes.filter((e) => e.sessaoPi === sessao);
  const primeira = encontrado(execucoes[0], ...erro);
  const ultima = encontrado(execucoes.at(-1), ...erro);
  const ticket = ticketDe(ag, ultima.ticket);
  const raiz = raizDo(banco);
  const mensagens = lerConversa(raiz, sessao).flatMap((entrada) => {
    const { type, message } = entrada as { type?: string; message?: Mensagem };
    return type === "message" && message ? [message] : [];
  });
  const modelos = new Set(
    mensagens.filter((m) => m.role === "assistant").map((m) => `${String(m.provider)}/${String(m.model)}`),
  );
  const cabecalho = [
    `# Histórico da sessão T-${String(ticket.id)} (I-${String(ag.issue.id)}, ${ticket.etapa})`,
    "",
    `- Projeto: ${ag.issue.projeto}`,
    `- Issue: I-${String(ag.issue.id)} — ${ag.issue.titulo ?? "(sem título)"}`,
    `- Ticket: T-${String(ticket.id)} — ${ticket.titulo}`,
    `- Etapa: ${ticket.etapa}`,
    `- Modelo: ${[...modelos].join(", ") || "—"}`,
    `- Início: ${primeira.iniciadaEm}`,
    `- Fim: ${ultima.terminadaEm ?? "em andamento"}`,
  ].join("\n");
  const daFabriquinha = promptsDaFabriquinha(raiz, ag, ticket.id);
  return [cabecalho, ...mensagens.flatMap((m) => emMarkdown(m, daFabriquinha))].join("\n\n") + "\n";
}

/**
 * O nome do arquivo do histórico da sessão, no anexo e no download: `historico-T-<n>.md`; a consulta ganha o id
 * dela, `historico-T-<n>-consulta-<sessao>.md`, para não se confundir com a principal.
 */
export function nomeDoHistorico({ sessao, ticket, modo }: Pick<InfoSessao, "sessao" | "ticket" | "modo">): string {
  const consulta = modo === "consulta" ? "-consulta-" + sessao : "";
  return `historico-T-${String(ticket)}${consulta}.md`;
}

/**
 * F4 §6.8: grava a exportação de cada sessão de origem em `historico-T-<n>.md` no `$FABRIQUINHA_SAIDA` da execução
 * atual (a última) da sessão de destino e devolve a `mensagem` com uma linha por anexo, para mandar com `enviar`.
 */
export async function anexarHistorico(
  banco: DatabaseSync,
  destino: string,
  origens: string[],
  mensagem: string,
): Promise<string> {
  const saida = join(dirDaExecucao(raizDo(banco), (await infoDaSessao(banco, destino)).execucao), "saida");
  mkdirSync(saida, { recursive: true });
  const linhas = [mensagem];
  for (const origem of origens) {
    const info = await infoDaSessao(banco, origem);
    const { ticket, issue, etapa } = info;
    const arquivo = join(saida, nomeDoHistorico(info));
    writeFileSync(arquivo, exportarHistorico(banco, origem));
    linhas.push(
      `Histórico da sessão T-${String(ticket)} (I-${String(issue)}, ${etapa}) em \`${arquivo}\`; leia antes de responder.`,
    );
  }
  return linhas.join("\n");
}

// Uma mensagem da conversa de uma sessão em Markdown (F4 §6.8), para o histórico que a página da sessão exporta: a
// formatação fica na borda, e Sessões só devolve a conversa guardada.
import type { Mensagem } from "../../../../modulos/sessoes/publico.ts";

/** ponytail: o corte é fixo (F4 §6.8); se algum resultado longo fizer falta, aumentar o limite. */
const CORTE = 2000;

interface Bloco {
  type?: string;
  text?: string;
  name?: string;
  arguments?: unknown;
}

const blocos = (m: Mensagem): Bloco[] =>
  typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;

/** O texto da mensagem; imagens e raciocínio ficam de fora. */
const texto = (m: Mensagem): string =>
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

/** Uma mensagem em Markdown: Fabriquinha, Auditor e agente na íntegra, chamadas e resultados cortados. */
export function emMarkdown(m: Mensagem, daFabriquinha: ReadonlySet<string>): string[] {
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

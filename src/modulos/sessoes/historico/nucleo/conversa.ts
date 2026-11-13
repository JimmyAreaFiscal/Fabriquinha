// As mensagens de uma conversa guardada (F4 §6.1.2): as perguntas que o Auditor respondeu e cada mensagem em Markdown.
// Puro: recebe as entradas já lidas (`lerConversaDoArquivo`).

// Sem espaço no fim: a seleção múltipla vem como "User selected:\n- 1. ...\n- 2. ..." (pacote-pi/extensions/pergunta.ts).
const PREFIXOS_DE_RESPOSTA = ["User answered:", "User selected:"];

/**
 * As perguntas que o agente fez com `perguntar` e que o Auditor respondeu: casa a chamada com o resultado pelo
 * `toolCallId`. Cancelamento e resposta vazia ficam de fora.
 */
export function perguntasRespondidasNaConversa(conversa: readonly unknown[]): { pergunta: string; resposta: string }[] {
  const mensagens = conversa.flatMap((entrada) => {
    const message = (entrada as { message?: Mensagem & { toolCallId?: string } } | null)?.message;
    // Linha fora da forma esperada (null, sem message, message sem content) não é conversa.
    if (typeof message?.content === "string") return [message];
    if (!Array.isArray(message?.content)) return [];
    // Bloco que não é objeto (null, número, texto solto) também não é conversa.
    return [
      {
        ...message,
        content: (message.content as unknown[]).filter((b) => typeof b === "object" && b !== null),
      },
    ];
  });
  const perguntaPorChamada = new Map<string, string>();
  for (const m of mensagens.filter((m) => m.role === "assistant")) {
    for (const b of blocos(m)) {
      const { id, arguments: args } = b as Bloco & { id?: string };
      if (b.type === "toolCall" && b.name === "perguntar" && id) {
        perguntaPorChamada.set(id, (args as { question?: string } | undefined)?.question ?? "");
      }
    }
  }
  return mensagens.flatMap((m) => {
    const pergunta = m.role === "toolResult" && perguntaPorChamada.get(String(m.toolCallId));
    const prefixo = PREFIXOS_DE_RESPOSTA.find((p) => texto(m).startsWith(p));
    const resposta = prefixo ? texto(m).slice(prefixo.length).trim() : "";
    return pergunta && resposta ? [{ pergunta, resposta }] : [];
  });
}

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

/** Uma mensagem em Markdown: Fabriquinha, Auditor e agente na íntegra, chamadas e resultados cortados. */
export function emMarkdown(m: Mensagem, daFabriquinha: Set<string>): string[] {
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

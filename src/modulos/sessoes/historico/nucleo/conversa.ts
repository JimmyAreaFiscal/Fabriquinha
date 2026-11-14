// As mensagens de uma conversa guardada (F4 §6.1.2): as perguntas que o Auditor respondeu e o texto de cada mensagem.
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

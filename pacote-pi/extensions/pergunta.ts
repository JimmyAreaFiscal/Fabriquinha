// Extensão `pergunta` do pacote P1 `pi-fabriquinha` (I-49): a ferramenta `perguntar`, no lugar da `ask_user_question` do
// Auditor, que no modo RPC falha com `ReferenceError`. Mesmos parâmetros e textos de resultado dela; as perguntas
// saem como diálogos `editor` (sem opções) e `select` (com opções) que o chat da Fabriquinha desenha. Não importa o
// pacote do pi.

interface Opcao {
  label: string;
  value?: string;
  description?: string;
}

interface Entrada {
  question: string;
  details?: string;
  options?: Opcao[];
  multiSelect?: boolean;
}

/** O pedaço do contexto de execução do pi que a ferramenta usa. */
interface Contexto {
  hasUI: boolean;
  ui: {
    select(titulo: string, opcoes: string[]): Promise<string | undefined>;
    editor(titulo: string): Promise<string | undefined>;
  };
}

/** O pedaço da API de extensões do pi que a extensão usa. */
interface Pi {
  registerTool(ferramenta: {
    name: string;
    label: string;
    description: string;
    promptSnippet: string;
    promptGuidelines: string[];
    parameters: object;
    execute(id: string, entrada: Entrada, sinal: unknown, aoAndar: unknown, ctx: Contexto): Promise<Resultado>;
  }): void;
}

interface Resultado {
  content: { type: "text"; text: string }[];
  details: undefined;
}

const resultado = (text: string): Resultado => ({ content: [{ type: "text", text }], details: undefined });

const CANCELADA = "User cancelled the question";

const opcao = {
  type: "object",
  properties: {
    label: {
      type: "string",
      description:
        'Display label for the option. If you recommend an option, place it first and append "(Recommended)" to the label.',
    },
    value: {
      type: "string",
      description: "Optional machine-readable value returned for the option. Defaults to the label.",
    },
    description: { type: "string", description: "Optional extra detail shown below the option." },
  },
  required: ["label"],
};

const PARAMETROS = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "The single question to ask the user. Ask exactly one question per tool call.",
    },
    details: { type: "string", description: "Optional extra context or instructions shown under the question." },
    options: {
      type: "array",
      items: opcao,
      description:
        "Optional multiple-choice options. Omit or pass an empty array for free-form text input. Users will always be able to choose Other and type a custom answer when options are provided.",
    },
    multiSelect: {
      type: "boolean",
      description: "Set to true to allow multiple answers to be selected for a question.",
    },
  },
  required: ["question"],
};

/** Os valores devolvidos pelo `select`: a lista em JSON na múltipla escolha; senão, o rótulo ou o texto livre. */
function respostas(valor: string, multipla: boolean | undefined): string[] {
  if (!multipla) return [valor];
  try {
    const lista: unknown = JSON.parse(valor);
    if (Array.isArray(lista)) return lista.map(String);
  } catch {
    // Não é JSON: o texto vale como uma resposta só.
  }
  return [valor];
}

/** `n. rótulo` para quem é um dos rótulos; `Other: texto` para o resto. As opções vêm pelo índice, e o Other por último. */
function formatadas(textos: string[], rotulos: string[]): string[] {
  const ordem = (texto: string) => rotulos.indexOf(texto) + 1 || Infinity;
  return textos
    .toSorted((a, b) => ordem(a) - ordem(b))
    .map((texto) => (rotulos.includes(texto) ? `${String(ordem(texto))}. ${texto}` : `Other: ${texto}`));
}

export default function pergunta(pi: Pi): void {
  pi.registerTool({
    name: "perguntar",
    label: "perguntar",
    description:
      "Ask the user a single question and pause execution until they answer. Use this when requirements are ambiguous, user preferences are needed, a decision would materially affect implementation, or you need confirmation before proceeding. Ask exactly one question per tool call, and prefer multiple separate tool calls over bundling unrelated questions together.",
    promptSnippet:
      "Use this tool to ask exactly one clarifying question, missing-requirement question, preference question, or decision question before continuing.",
    promptGuidelines: [
      "Ask exactly one question per tool call.",
      "If you need answers to multiple questions, make multiple separate perguntar tool calls instead of combining them into one prompt.",
      'Users will always be able to select "Other" to provide custom text input when options are provided.',
      "Use multiSelect: true only when you need multiple answers to the same question.",
      'If you recommend a specific option, make it the first option in the list and add "(Recommended)" at the end of the label.',
      "Prefer this tool over guessing when requirements, preferences, or implementation choices are unclear.",
      "Use this tool when multiple valid implementation paths exist and the preferred path depends on user choice.",
    ],
    parameters: PARAMETROS,
    async execute(_id, { question, details, options = [], multiSelect }, _sinal, _aoAndar, ctx) {
      if (!ctx.hasUI) return resultado("ask_user_question requires interactive mode UI");
      const rotulos = options.map((o) => o.label.trim()).filter(Boolean);
      if (rotulos.length === 0) {
        const contexto = details?.trim();
        const texto = await ctx.ui.editor(contexto ? `${question}\n\n${contexto}` : question);
        if (texto === undefined) return resultado(CANCELADA);
        return resultado(texto.trim() ? `User answered: ${texto.trim()}` : "User submitted an empty response");
      }
      const valor = await ctx.ui.select(question, rotulos);
      const escolhidas = valor === undefined ? [] : respostas(valor, multiSelect);
      if (escolhidas.length === 0) return resultado(CANCELADA);
      const linhas = formatadas(escolhidas, rotulos);
      const itens = linhas.length === 1 ? ` ${String(linhas[0])}` : "\n" + linhas.map((l) => "- " + l).join("\n");
      return resultado("User selected:" + itens);
    },
  });
}

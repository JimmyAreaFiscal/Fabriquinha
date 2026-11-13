// O que o chat transporta de uma sessão viva (F4 §5.2, §5.4): os eventos do agente, a mudança de estado, os diálogos
// que esperam o Auditor, a pergunta da `perguntar` e a resposta automática a ela, e o que o agente está fazendo.
import type { EventoDoAgente, PedidoDeExtensao } from "../../harness/publico.ts";

/** Diálogos que esperam resposta; `notify` e afins não esperam, e `custom` nunca chega no modo RPC (P1 §2.1). */
export const DIALOGOS = new Set(["select", "confirm", "input", "editor"]);

/** A pergunta que o agente fez com a `perguntar`, como a política a lê para decidir se responde sozinha. */
export interface PerguntaDoAgente {
  pergunta: string;
  detalhes?: string;
  /** Os rótulos das opções; vazio na pergunta de texto livre. */
  opcoes: string[];
  /** As descrições das opções, na ordem de `opcoes` ("" sem descrição); ausente quando nenhuma tem. */
  descricoes?: string[];
}

/** A resposta que a política dá a uma pergunta do agente, sem esperar o Auditor. */
export interface RespostaAPergunta {
  /** Um dos rótulos, na pergunta com opções; senão, o texto da resposta. */
  resposta: string;
  justificativa: string;
}

/**
 * A resposta automática a uma chamada de `perguntar`: ela vai ao log numa linha com este prefixo e ao chat, e o autor é
 * o agente da execução em curso, não o Auditor (CONCEITOS.md §15).
 */
export interface RespostaAutomatica extends RespostaAPergunta {
  ator: { tipo: "agente"; trabalho_id: string };
  /** O `toolCallId` da chamada de `perguntar` que ela respondeu. */
  chamada: string;
  pergunta: string;
}
export const PREFIXO_DA_RESPOSTA_AUTOMATICA = "resposta automática ";

/**
 * Um diálogo de extensão pendente: o pedido do agente, quando chegou e, se o agente o resolve sozinho, quando expira. O
 * select aberto pela `perguntar` traz também o que o chat mostra dela (`daPergunta`).
 */
export type Dialogo = PedidoDeExtensao & {
  em: string;
  expiraEm?: string;
  pergunta?: true;
  multiSelect?: boolean;
  descricoes?: (string | undefined)[];
};

/** O que quem assina a sessão recebe: os eventos do agente, a mudança de estado e a resposta automática. */
export type EventoDaSessao =
  EventoDoAgente | { type: "estado" } | ({ type: "resposta_automatica" } & RespostaAutomatica);

/** O que o estado da sessão (F4 §5.2) lê de um processo vivo. */
export interface Situacao {
  /** O id da execução. */
  execucao: number | string;
  /** O agente está trabalhando; falso quando uma sessão interativa espera a próxima mensagem. */
  ocupado: boolean;
  /** Desde quando está ocupada ou ociosa. */
  desde: string;
  dialogos: Dialogo[];
  /** O que o agente está fazendo, pelo último evento que o diz (`atividadeDo`). */
  atividade?: string;
}

/** Uma linha de até 100 caracteres. */
const linha = (texto: string): string => (texto.length > 100 ? `${texto.slice(0, 99)}…` : texto);

/**
 * O que o agente está fazendo, se o evento o diz (F7 §4.4, Início): a ferramenta que começou a rodar, com o comando
 * ou o caminho, ou a primeira linha do texto que ele acabou de escrever. Os demais eventos não mudam a atividade.
 */
export function atividadeDo(evento: EventoDoAgente): string | undefined {
  if (evento.type === "tool_execution_start") {
    const alvo = [evento.args.command, evento.args.path].find((x) => typeof x === "string");
    return linha([evento.toolName, alvo].filter(Boolean).join(" "));
  }
  const m = evento.type === "message_end" ? evento.message : undefined;
  if (m?.role !== "assistant" || !Array.isArray(m.content)) return undefined;
  const texto = m.content
    .filter((b) => b.type === "text")
    .map((b) => String(b.text))
    .join("\n");
  const primeira = texto
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return primeira && linha(primeira);
}

/** O que o chat precisa saber do select aberto pela `perguntar` (a de `title` igual a `args.question`); `undefined` nos demais. */
export function daPergunta(
  evento: PedidoDeExtensao,
  emExecucao: Iterable<Readonly<Record<string, unknown>>>,
): Partial<Dialogo> | undefined {
  const args = [...emExecucao].find((a) => a.question === evento.title);
  if (!args) return undefined;
  const opcoes = (args.options ?? []) as { description?: string }[];
  return {
    pergunta: true,
    multiSelect: Boolean(args.multiSelect),
    descricoes: opcoes.map((o) => o.description),
    message: args.details as string | undefined,
  };
}

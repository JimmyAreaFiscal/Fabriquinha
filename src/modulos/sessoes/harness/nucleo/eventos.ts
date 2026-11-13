// O contrato dos eventos do agente (MELHORIAS §9, regra 4): o que a Fabriquinha lê de um agente enquanto ele trabalha,
// fechado e independente do harness. O adapter de cada harness traduz os eventos dele para estes; trocar de harness não
// muda quem os consome. Os nomes e os campos são os que o condutor e o chat leem, e o fluxo SSE do chat os entrega assim.
// Só tipos.

/** Um bloco do conteúdo de uma mensagem: texto, raciocínio, chamada de ferramenta ou imagem. */
interface BlocoDaMensagem {
  type?: string;
  text?: string;
}

/**
 * Uma mensagem da conversa: do usuário, do agente ou o resultado de uma ferramenta. Vem no formato em que a conversa
 * fica guardada, porque o chat junta a mensagem ao vivo com as que lê da conversa.
 */
export interface MensagemDoAgente {
  role?: string;
  content?: string | BlocoDaMensagem[];
  /** Por que a mensagem do agente parou: `error` e `aborted` decidem a falha (F4 §6.2, passo 5). */
  stopReason?: string;
  errorMessage?: string;
}

/** O agente começou a trabalhar. */
interface AgenteComecou {
  type: "agent_start";
}

/** O agente assentou: não continua sozinho (sem nova tentativa, compactação ou mensagem na fila). */
interface AgenteAssentou {
  type: "agent_settled";
}

/** Uma mensagem começou (`message_start`) ou terminou (`message_end`, a versão final dela). */
interface MensagemComecouOuTerminou {
  type: "message_start" | "message_end";
  /** Ausente quando o harness não a mandou. */
  message?: MensagemDoAgente;
}

/** Um pedaço da mensagem que o agente está escrevendo: `delta` soma ao texto (`text_delta`) ou ao raciocínio (`thinking_delta`). */
interface MensagemEmEscrita {
  type: "message_update";
  assistantMessageEvent: { type: string; delta?: string };
}

/** Uma ferramenta começou a rodar, com os argumentos da chamada. */
interface FerramentaComecou {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: Readonly<Record<string, unknown>>;
}

/** A ferramenta da chamada `toolCallId` terminou. */
interface FerramentaTerminou {
  type: "tool_execution_end";
  toolCallId: string;
}

/** A resposta do agente a um comando: `success: false` é a recusa, com o motivo em `error`. */
interface RespostaAoComando {
  type: "response";
  command: string;
  success: boolean;
  error?: string;
}

/**
 * Um pedido de extensão ao Auditor: um diálogo (`select`, `confirm`, `input`, `editor`) que espera a resposta pelo `id`,
 * ou um aviso. Com `timeout` (ms), o agente resolve o diálogo sozinho quando ele expira.
 */
export interface PedidoDeExtensao {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
}

/** Qualquer outro evento do agente: a Fabriquinha não o lê, mas ele mostra que o agente segue ativo. */
interface SinalDeVida {
  type: "sinal_de_vida";
}

export type EventoDoAgente =
  | AgenteComecou
  | AgenteAssentou
  | MensagemComecouOuTerminou
  | MensagemEmEscrita
  | FerramentaComecou
  | FerramentaTerminou
  | RespostaAoComando
  | PedidoDeExtensao
  | SinalDeVida;

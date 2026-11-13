// A tradução dos registros do stdout do pi em modo RPC (os eventos da sessão, as respostas aos comandos e os pedidos de
// extensão) para o contrato de eventos da Fabriquinha (`nucleo/eventos.ts`). Só aqui se lê o formato do pi.
import type { EventoDoAgente, MensagemDoAgente, PedidoDeExtensao } from "../../nucleo/eventos.ts";

/** Um objeto JSON de uma linha do stdout do pi. */
export type RegistroDoPi = Record<string, unknown>;

const ehObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null;

/** Os campos opcionais do pedido de extensão que o pi mandou, sem acrescentar os ausentes. */
const CAMPOS_DO_PEDIDO_DE_EXTENSAO = ["title", "message", "options", "placeholder", "prefill", "timeout"] as const;

function pedidoDeExtensao(registro: RegistroDoPi): PedidoDeExtensao {
  const camposPresentes = CAMPOS_DO_PEDIDO_DE_EXTENSAO.filter((campo) => registro[campo] !== undefined).map((campo) => [
    campo,
    registro[campo],
  ]);
  return {
    type: "extension_ui_request",
    id: String(registro.id),
    method: String(registro.method),
    ...(Object.fromEntries(camposPresentes) as Partial<PedidoDeExtensao>),
  };
}

/** O evento do contrato para o registro do pi; o registro que a Fabriquinha não lê vira `sinal_de_vida`. */
export function traduzirEventoDoPi(registro: RegistroDoPi): EventoDoAgente {
  switch (registro.type) {
    case "agent_start":
    case "agent_settled":
      return { type: registro.type };
    case "message_start":
    case "message_end":
      return {
        type: registro.type,
        ...(ehObjeto(registro.message) && { message: registro.message as MensagemDoAgente }),
      };
    case "message_update": {
      const pedaco = ehObjeto(registro.assistantMessageEvent) ? registro.assistantMessageEvent : {};
      return {
        type: "message_update",
        assistantMessageEvent: {
          type: String(pedaco.type),
          ...(typeof pedaco.delta === "string" && { delta: pedaco.delta }),
        },
      };
    }
    case "tool_execution_start":
      return {
        type: "tool_execution_start",
        toolCallId: String(registro.toolCallId),
        toolName: String(registro.toolName),
        args: ehObjeto(registro.args) ? registro.args : {},
      };
    case "tool_execution_end":
      return { type: "tool_execution_end", toolCallId: String(registro.toolCallId) };
    case "response":
      return {
        type: "response",
        command: String(registro.command),
        success: registro.success !== false,
        ...(typeof registro.error === "string" && { error: registro.error }),
      };
    case "extension_ui_request":
      return pedidoDeExtensao(registro);
    default:
      return { type: "sinal_de_vida" };
  }
}

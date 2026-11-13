// A tradução dos registros do pi para o contrato de eventos: cada tipo que a Fabriquinha lê, só com os campos dele.
import assert from "node:assert/strict";
import { test } from "node:test";
import { traduzirEventoDoPi } from "./eventos_do_pi.ts";

test("o início e o assentamento do agente vão sem os campos do pi", () => {
  assert.deepEqual(traduzirEventoDoPi({ type: "agent_start" }), { type: "agent_start" });
  assert.deepEqual(traduzirEventoDoPi({ type: "agent_settled", aborted: false }), { type: "agent_settled" });
});

test("a mensagem vai como veio; sem objeto, o evento vai sem ela", () => {
  const mensagem = { role: "assistant", content: [{ type: "text", text: "oi" }], stopReason: "stop", model: "m" };
  assert.deepEqual(traduzirEventoDoPi({ type: "message_start", message: mensagem }), {
    type: "message_start",
    message: mensagem,
  });
  assert.deepEqual(traduzirEventoDoPi({ type: "message_end", message: null }), { type: "message_end" });
  assert.deepEqual(traduzirEventoDoPi({ type: "message_end" }), { type: "message_end" });
});

test("o pedaço da mensagem em escrita leva só o tipo e o delta", () => {
  assert.deepEqual(
    traduzirEventoDoPi({
      type: "message_update",
      usage: { input: 1 },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "oi" },
    }),
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "oi" } },
  );
  assert.deepEqual(traduzirEventoDoPi({ type: "message_update", assistantMessageEvent: { type: "text_start" } }), {
    type: "message_update",
    assistantMessageEvent: { type: "text_start" },
  });
  assert.deepEqual(traduzirEventoDoPi({ type: "message_update" }), {
    type: "message_update",
    assistantMessageEvent: { type: "undefined" },
  });
});

test("a ferramenta leva a chamada, o nome e os argumentos; o fim, só a chamada", () => {
  assert.deepEqual(
    traduzirEventoDoPi({ type: "tool_execution_start", toolCallId: "b1", toolName: "bash", args: { command: "ls" } }),
    { type: "tool_execution_start", toolCallId: "b1", toolName: "bash", args: { command: "ls" } },
  );
  assert.deepEqual(traduzirEventoDoPi({ type: "tool_execution_start", toolCallId: "l1", toolName: "ls" }), {
    type: "tool_execution_start",
    toolCallId: "l1",
    toolName: "ls",
    args: {},
  });
  assert.deepEqual(
    traduzirEventoDoPi({ type: "tool_execution_end", toolCallId: "b1", toolName: "bash", result: {}, isError: false }),
    { type: "tool_execution_end", toolCallId: "b1" },
  );
});

test("a resposta a um comando: só a recusa explícita é recusa, com o motivo quando o pi o dá", () => {
  assert.deepEqual(
    traduzirEventoDoPi({ type: "response", id: "r", command: "steer", success: false, error: "rejeitado" }),
    { type: "response", command: "steer", success: false, error: "rejeitado" },
  );
  assert.deepEqual(traduzirEventoDoPi({ type: "response", command: "prompt", success: true, data: {} }), {
    type: "response",
    command: "prompt",
    success: true,
  });
  assert.deepEqual(traduzirEventoDoPi({ type: "response", command: "abort" }), {
    type: "response",
    command: "abort",
    success: true,
  });
});

test("o pedido de extensão leva só os campos que o pi mandou", () => {
  assert.deepEqual(
    traduzirEventoDoPi({
      type: "extension_ui_request",
      id: "s1",
      method: "select",
      title: "Qual?",
      options: ["a", "b"],
      timeout: 150,
    }),
    { type: "extension_ui_request", id: "s1", method: "select", title: "Qual?", options: ["a", "b"], timeout: 150 },
  );
  assert.deepEqual(
    traduzirEventoDoPi({ type: "extension_ui_request", id: "n1", method: "notify", message: "oi", notifyType: "info" }),
    { type: "extension_ui_request", id: "n1", method: "notify", message: "oi" },
  );
  assert.deepEqual(
    traduzirEventoDoPi({ type: "extension_ui_request", id: "e1", method: "editor", title: "T", prefill: "p" }),
    { type: "extension_ui_request", id: "e1", method: "editor", title: "T", prefill: "p" },
  );
});

test("o registro que a Fabriquinha não lê é só um sinal de vida", () => {
  for (const registro of [{ type: "turn_start" }, { type: "auto_retry_start", attempt: 1 }, {}]) {
    assert.deepEqual(traduzirEventoDoPi(registro), { type: "sinal_de_vida" });
  }
});

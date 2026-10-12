#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// pi falso do e2e (F4 §12), via FABRIQUINHA_PI: responde `--version`, lista modelos em `--list-models` e, no modo
// RPC, a cada `prompt` responde com $FALSO_PI_RESPOSTA (padrão "pronto"), grava a resposta no JSONL da sessão e
// assenta. Os testes que precisam de outro comportamento acrescentam variantes aqui.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const argumentos = process.argv.slice(2);
const emitir = (evento: object) => process.stdout.write(`${JSON.stringify(evento)}\n`);
const arg = (nome: string) => argumentos[argumentos.indexOf(nome) + 1] ?? "";

if (argumentos.includes("--version")) {
  console.log("0.0.0-falso");
  process.exit(0);
}
if (argumentos.includes("--list-models")) {
  console.log("provider   model              context  max-out  thinking  images");
  console.log("anthropic  claude-opus-5-5    200K     64K      yes       yes");
  console.log("anthropic  claude-sonnet-5-5  200K     64K      yes       yes");
  process.exit(0);
}

/** Como o pi, grava cada mensagem em `<session-dir>/<instante>_<session-id>.jsonl` e a emite. */
function mensagem(message: object): void {
  mkdirSync(arg("--session-dir"), { recursive: true });
  appendFileSync(
    join(arg("--session-dir"), `2026-10-12T00-00-00-000Z_${arg("--session-id")}.jsonl`),
    `${JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message })}\n`,
  );
  emitir({ type: "message_end", message });
}

function aoPrompt(texto: string): void {
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "agent_start" });
  mensagem({ role: "user", content: texto });
  mensagem({
    role: "assistant",
    content: [{ type: "text", text: process.env.FALSO_PI_RESPOSTA ?? "pronto" }],
    provider: "anthropic",
    model: "claude-opus-5-5",
    stopReason: "stop",
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { total: 0.01 } },
  });
  emitir({ type: "agent_settled" });
}

let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte: string) => {
  const linhas = (resto + parte).split("\n");
  resto = linhas.pop() ?? "";
  for (const linha of linhas) {
    const comando = JSON.parse(linha) as { type?: string; message?: string };
    if (comando.type === "prompt") aoPrompt(comando.message ?? "");
  }
});

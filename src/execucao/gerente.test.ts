// Gerente (F4 §2, §5.4, §6.6, §6.7) com um pi falso de verdade: a recusa de um comando na autônoma e na interativa, o
// relógio da autônoma parado enquanto um diálogo espera, o diálogo que expira, o aborto e a atividade do agente.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abortar, atividadeDo, encerrar, responderDialogo, rodarPi, situacao } from "./gerente.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-gerente-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** pi falso: responde ao prompt conforme $FALSO_PI (recusa, dialogo, pergunta ou trabalha sem fim) e ao `abort`. */
const pi = join(base, "pi.mjs");
writeFileSync(
  pi,
  `#!/usr/bin/env node
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const variante = process.env.FALSO_PI;
const assistente = (stopReason) => emitir({ type: "message_end", message: { role: "assistant", content: [], stopReason } });
function aoPrompt() {
  if (variante === "recusa") return emitir({ type: "response", command: "prompt", success: false, error: "modelo inexistente" });
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "agent_start" });
  if (variante === "dialogo") {
    emitir({ type: "extension_ui_request", id: "c1", method: "confirm", title: "Seguir?", timeout: 150 });
    emitir({ type: "extension_ui_request", id: "s1", method: "select", title: "Qual?", options: ["a", "b"] });
  }
  if (variante === "pergunta") {
    emitir({ type: "tool_execution_start", toolCallId: "p1", toolName: "perguntar", args: { question: "Qual?" } });
    emitir({ type: "extension_ui_request", id: "s1", method: "select", title: "Qual?", options: ["a"] });
  }
}
// Como o pi que assenta ao receber o SIGTERM: o evento chega depois do fim da execução.
process.on("SIGTERM", () => {
  emitir({ type: "agent_settled" });
  setTimeout(() => process.exit(0), 50);
});
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    if (c.type === "prompt") aoPrompt();
    if (c.type === "extension_ui_response" && !c.cancelled) {
      assistente("stop");
      emitir({ type: "agent_settled" });
    }
    if (c.type === "abort") {
      assistente("aborted");
      emitir({ type: "agent_settled" });
    }
  }
});
`,
);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

let n = 0;
/** Roda o pi falso na `variante`, no `modo`, com o `limiteMin`; devolve a sessão e a promessa do fim. */
function rodar(variante: string, modo: "autonomo" | "interativo", limiteMin = 1) {
  const sessao = `s-${String(++n)}`;
  const dir = mkdtempSync(join(base, "exec-"));
  const fim = rodarPi({
    execucao: { id: sessao, sessaoPi: sessao, modo },
    args: [],
    cwd: dir,
    env: { ...process.env, FALSO_PI: variante },
    log: join(dir, "log"),
    prompt: "trabalhe",
    limiteMin,
    aoLancar: () => undefined,
  });
  return { sessao, fim };
}

async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 10) {
    assert.ok(espera < 5000, `${oQue} não aconteceu em 5 s`);
    await dormir(10);
  }
}

test("autônoma: o pi que recusa o prompt falha na hora, sem esperar o tempo limite", async () => {
  assert.equal(await rodar("recusa", "autonomo").fim, "o pi recusou o comando prompt: modelo inexistente");
});

test("interativa: a recusa do prompt só fica no log, a sessão fica ociosa e termina bem quando encerrada", async () => {
  const { sessao, fim } = rodar("recusa", "interativo");
  await ate(() => situacao(sessao)?.ocupado === false, "a sessão ociosa");
  encerrar(sessao);
  assert.equal(await fim, undefined);
});

test("autônoma: o relógio para enquanto o diálogo espera; o diálogo com tempo limite expira e o respondido segue", async () => {
  // 0,005 min = 300 ms: o diálogo fica pendente por mais tempo que isso sem a execução estourar o limite.
  const { sessao, fim } = rodar("dialogo", "autonomo", 0.005);
  await ate(() => (situacao(sessao)?.dialogos.length ?? 0) === 2, "os dois diálogos");
  assert.ok(situacao(sessao)?.dialogos.find((d) => d.id === "c1")?.expiraEm);
  await ate(() => situacao(sessao)?.dialogos.length === 1, "a expiração do confirm");
  await dormir(400);
  assert.equal(situacao(sessao)?.dialogos[0]?.id, "s1", "sem estourar o limite com o diálogo pendente");
  responderDialogo(sessao, "s1", { value: "a" });
  assert.throws(() => {
    responderDialogo(sessao, "s1", { value: "a" });
  }, ErroDeRegra);
  assert.equal(await fim, undefined);
});

test("autônoma: o select da perguntar vira a pergunta do chat; abortar dá a falha de abortada pelo Auditor", async () => {
  const { sessao, fim } = rodar("pergunta", "autonomo");
  await ate(() => situacao(sessao)?.dialogos.length === 1, "a pergunta");
  assert.equal(situacao(sessao)?.dialogos[0]?.pergunta, true);
  abortar(sessao);
  assert.equal(await fim, "abortada pelo Auditor");
});

test("encerrar a autônoma com um diálogo de tempo limite pendente para o relógio dele; o assentar depois do fim não arma relógio", async () => {
  const comDialogo = rodar("dialogo", "autonomo");
  await ate(() => (situacao(comDialogo.sessao)?.dialogos.length ?? 0) === 2, "os diálogos");
  encerrar(comDialogo.sessao);
  assert.equal(await comDialogo.fim, undefined);

  const trabalhando = rodar("trabalha", "interativo");
  await ate(() => situacao(trabalhando.sessao)?.ocupado === true, "o agente trabalhando");
  encerrar(trabalhando.sessao);
  assert.equal(await trabalhando.fim, undefined);
  assert.equal(situacao(trabalhando.sessao), undefined);
});

test("atividade: a ferramenta com o comando ou o caminho, a primeira linha do texto, cortada em 100 caracteres", () => {
  assert.equal(
    atividadeDo({ type: "tool_execution_start", toolName: "read", args: { path: "src/a.ts" } }),
    "read src/a.ts",
  );
  assert.equal(atividadeDo({ type: "tool_execution_start", toolName: "ls" }), "ls");
  const longo = "x".repeat(120);
  const fala = (content: unknown) => atividadeDo({ type: "message_end", message: { role: "assistant", content } });
  assert.equal(fala([{ type: "text", text: `\n  ${longo}\noutra` }]), `${"x".repeat(99)}…`);
  assert.equal(fala("texto solto"), undefined);
  assert.equal(fala([{ type: "toolCall" }]), undefined);
  assert.equal(atividadeDo({ type: "message_end", message: null }), undefined);
  assert.equal(atividadeDo({ type: "agent_start" }), undefined);
});

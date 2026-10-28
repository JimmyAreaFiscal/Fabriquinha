// Falsos da suíte de integração do SDLC: o pi (executável Node roteirizado por JSON, em $FABRIQUINHA_PI) e a hospedagem
// (`gh` na frente do PATH, com o estado dos PRs num JSON). Combinado com a I-244: quem precisa de mais, acrescenta aqui.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hospedagemFalsa } from "../src/repositorio/hospedagem-falsa.test.ts";

/** Um passo do roteiro do pi falso; cada execução do pi consome um passo, e o último se repete. */
export interface PassoPi {
  /** ok: assenta; sem_submeter: escreve na worktree e assenta sem rodar o agente; trava: nunca responde; erro: sai com 1. */
  modo: "ok" | "sem_submeter" | "trava" | "erro";
  /** Caminho (absoluto ou relativo à worktree) → conteúdo a escrever, ou null para apagar. */
  escreve?: Record<string, string | null>;
  /** Módulo `.mjs` (default export assíncrono) que faz o que o CLI do agente faria; só no modo `ok`. */
  agente?: string;
}

// Lê o roteiro a cada prompt (o teste o reescreve entre execuções) e registra cada chamada no JSONL.
const SCRIPT = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("0.84.4-falso");
  process.exit(0);
}
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let resto = "";
let tratado = false;
process.stdin.setEncoding("utf8").on("data", async (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  const prompt = linhas.filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.type === "prompt");
  if (!prompt || tratado) return;
  tratado = true;
  const roteiro = JSON.parse(readFileSync(process.env.FALSO_PI_ROTEIRO, "utf8"));
  const log = process.env.FALSO_PI_CHAMADAS;
  const n = existsSync(log) ? readFileSync(log, "utf8").split("\\n").filter(Boolean).length : 0;
  appendFileSync(log, JSON.stringify({ cwd: process.cwd(), prompt: prompt.message }) + "\\n");
  const passo = roteiro[Math.min(n, roteiro.length - 1)];
  if (passo.modo === "erro") {
    process.stderr.write("falha do pi falso\\n");
    process.exit(1);
  }
  if (passo.modo === "trava") return setInterval(() => {}, 1000);
  for (const [caminho, conteudo] of Object.entries(passo.escreve ?? {})) {
    if (conteudo === null) rmSync(caminho);
    else writeFileSync(caminho, conteudo);
  }
  if (passo.modo === "ok" && passo.agente) await (await import(passo.agente)).default();
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } });
  emitir({ type: "agent_settled" });
});
`;

/** Instala o pi falso em `<dir>/pi.mjs` e aponta $FABRIQUINHA_PI para ele; o roteiro padrão é um passo `ok`. */
export function piFalso(dir: string) {
  const executavel = join(dir, "pi.mjs");
  const roteiro = join(dir, "pi-roteiro.json");
  const chamadas = join(dir, "pi-chamadas.jsonl");
  writeFileSync(executavel, SCRIPT);
  chmodSync(executavel, 0o755);
  process.env.FABRIQUINHA_PI = executavel;
  process.env.FALSO_PI_ROTEIRO = roteiro;
  process.env.FALSO_PI_CHAMADAS = chamadas;
  const falso = {
    /** Troca o roteiro e zera o registro de chamadas. */
    roteirizar(passos: PassoPi[] = [{ modo: "ok" }]) {
      writeFileSync(roteiro, JSON.stringify(passos));
      writeFileSync(chamadas, "");
      return falso;
    },
    /** Um item por prompt que algum pi recebeu, na ordem. */
    chamadas: (): { cwd: string; prompt: string }[] =>
      existsSync(chamadas)
        ? readFileSync(chamadas, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l) as { cwd: string; prompt: string })
        : [],
  };
  return falso.roteirizar();
}

/** O `gh` falso (a hospedagem já testada em `hospedagem-falsa.test.ts`) com os cenários da seção 12 nomeados. */
export function ghFalso(dir: string) {
  const h = hospedagemFalsa(dir);
  h.zerar();
  return {
    ...h,
    conflito: (id: number) => {
      h.mudar(id, { conflito: true });
    },
    checkFalho: (id: number) => {
      h.mudar(id, { checks: [{ nome: "ci", estado: "falho" }] });
    },
    mergeFalha: (stderr = "merge recusado pela hospedagem") => {
      h.falhar("pr merge", stderr);
    },
  };
}

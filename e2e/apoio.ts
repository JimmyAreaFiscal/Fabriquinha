// Apoio dos testes de ponta a ponta: cada teste sobe a sua Fabriquinha, com a raiz temporária, uma porta livre e o pi
// falso (pi-falso.ts), e recebe o navegador já autenticado pelo link de `web.url`, como o Auditor depois do `abrir`.
import { test as base, type Page } from "@playwright/test";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { abrir } from "../src/persistencia/banco.ts";
import { registrarProjeto } from "../src/persistencia/projetos.ts";

export interface Fabriquinha {
  /** A raiz da instância: banco, `web.url`, sessões e execuções. */
  raiz: string;
  /** `http://127.0.0.1:<porta>`, para `page.goto(`${base}/config`)`. */
  base: string;
  /** O link de entrada com o token, lido de `web.url`. */
  link: string;
}

async function portaLivre(): Promise<number> {
  const s = createServer().listen(0, "127.0.0.1");
  await once(s, "listening");
  const { port } = s.address() as { port: number };
  s.close();
  await once(s, "close");
  return port;
}

/** Para o serviço com SIGTERM; se não sair em 5 s, SIGKILL. */
async function parar(servico: ChildProcess): Promise<void> {
  if (servico.exitCode !== null) return;
  const saiu = once(servico, "exit");
  servico.kill("SIGTERM");
  if (await Promise.race([saiu.then(() => true), dormir(5000).then(() => false)])) return;
  servico.kill("SIGKILL");
  await saiu;
}

export const test = base.extend<{ fabriquinha: Fabriquinha; pagina: Page }>({
  // eslint-disable-next-line no-empty-pattern -- o Playwright lê as dependências da desestruturação; esta não tem.
  fabriquinha: async ({}, use) => {
    const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-e2e-"));
    // git e pi sem a configuração do usuário da máquina.
    const gitconfig = join(raiz, "gitconfig");
    writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
    // gh falso, autenticado: a conferência do cadastro de projeto (F5 §2) passa sem rede, e `gh pr view` responde o
    // estado do PR que o teste gravou com `prNoGitHub`.
    const bin = join(raiz, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh\nif [ "$1 $2" = "pr view" ]; then cat "${join(raiz, "gh-pr.json")}"; fi\nexit 0\n`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    const porta = await portaLivre();
    let log = "";
    const servico = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "servidor.ts"), raiz],
      {
        env: {
          ...process.env,
          FABRIQUINHA_PORTA: String(porta),
          FABRIQUINHA_PI: join(import.meta.dirname, "pi-falso.ts"),
          PI_CODING_AGENT_DIR: join(raiz, "pi-agent"),
          GIT_CONFIG_GLOBAL: gitconfig,
          GIT_CONFIG_NOSYSTEM: "1",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "inherit", "pipe"],
      },
    );
    servico.stderr.on("data", (parte: Buffer) => {
      log += parte.toString();
    });
    try {
      const arquivo = join(raiz, "web.url");
      for (let i = 0; !existsSync(arquivo); i++) {
        if (servico.exitCode !== null || i > 200) throw new Error(`a Fabriquinha não subiu:\n${log}`);
        await dormir(50);
      }
      await use({ raiz, base: `http://127.0.0.1:${String(porta)}`, link: readFileSync(arquivo, "utf8") });
    } finally {
      await parar(servico);
      if (log.trim()) console.log(`stderr da Fabriquinha:\n${log}`);
      rmSync(raiz, { recursive: true, force: true });
    }
  },
  pagina: async ({ page, fabriquinha }, use) => {
    await page.goto(fabriquinha.link);
    await use(page);
  },
});

export { expect } from "@playwright/test";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/** O projeto `loja`, com um clone de verdade e o remoto num bare local, para a worktree das execuções. */
export function projeto(raiz: string, sql = ""): void {
  const bare = join(raiz, "origin.git");
  const repo = join(raiz, "loja");
  mkdirSync(repo);
  git(raiz, "init", "-q", "--bare", bare);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "LEIAME"), "loja\n");
  git(repo, "add", "LEIAME");
  git(repo, "commit", "-q", "-m", "início");
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-q", "origin", "main");
  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "loja",
    repo: realpathSync(repo),
    branchBase: "main",
    hospedagem: "github",
    preparacao: [],
    testes: ["true"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    modelos: {},
  });
  banco.exec(sql);
  banco.close();
}

/** O estado do PR que o `gh pr view` falso devolve (F5 §5.2). */
export function prNoGitHub(raiz: string, state: "OPEN" | "MERGED", url: string): void {
  writeFileSync(
    join(raiz, "gh-pr.json"),
    JSON.stringify({ state, url, mergedAt: state === "MERGED" ? "2026-10-11T15:02:00Z" : null, mergeCommit: null }),
  );
}

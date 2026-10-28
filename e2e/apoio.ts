// Apoio dos testes de ponta a ponta: cada teste sobe a sua Fabriquinha, com a raiz temporária, a porta livre que ela
// mesma escolhe (FABRIQUINHA_PORTA=0, sem corrida entre escolher e ocupar) e o pi falso (pi-falso.ts), e recebe o
// navegador já autenticado pelo link de `web.url`, como o Auditor depois do `abrir`.
import { test as base, type Page, type TestInfo } from "@playwright/test";
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { recuperarAuditorias } from "../src/execucao/auditoria.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { registrarProjeto } from "../src/persistencia/projetos.ts";
import { execucoesAbertasDaDemanda } from "../src/persistencia/sessoes.ts";
import { falharPendentes } from "../src/persistencia/simulacao.ts";
import { sinalNoGrupo } from "../src/processo.ts";

export interface Fabriquinha {
  /** A raiz da instância: banco, `web.url`, sessões e execuções. */
  raiz: string;
  /** `http://127.0.0.1:<porta>`, para `page.goto(`${base}/config`)`. */
  base: string;
  /** O link de entrada com o token, lido de `web.url`. */
  link: string;
  /** O processo do serviço, para o teste mandar o SIGTERM e ler o código de saída. */
  servico: ChildProcess;
  /** Tudo o que o serviço escreveu no stderr até agora. */
  stderr(): string;
  /** Sobe outro serviço na mesma raiz (o primeiro já parado); devolve o endereço e o link dele. */
  reiniciar(): Promise<{ base: string; link: string }>;
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

/**
 * F4 §7: o serviço parado deixa o pi rodando, e quem o mata é a subida seguinte, que no teste não vem. Sem isso, o pi
 * ainda escreve na raiz enquanto ela é apagada.
 */
function matarPi(raiz: string): void {
  const banco = abrir(raiz);
  for (const { grupo_processo } of execucoesAbertasDaDemanda(banco)) {
    if (grupo_processo !== null) sinalNoGrupo(grupo_processo, "SIGKILL");
  }
  for (const pgid of falharPendentes(banco, "fim do teste")) sinalNoGrupo(pgid, "SIGKILL");
  banco.close();
  recuperarAuditorias(raiz);
}

export const test = base.extend<{ fabriquinha: Fabriquinha; pagina: Page; pi: string }>({
  /** O binário do pi que a Fabriquinha usa (`FABRIQUINHA_PI`); o falso, a menos que o teste troque com `test.use`. */
  pi: [join(import.meta.dirname, "pi-falso.ts"), { option: true }],
  fabriquinha: async ({ pi }, use) => {
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
    /** Sobe o serviço na raiz e espera o `web.url`; `stderr()` junta o que ele escreveu até agora. */
    async function subir(): Promise<{ servico: ChildProcess; link: string; stderr: () => string }> {
      let log = "";
      const servico = spawn(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "../src/cli/fabriquinha.ts"), "servidor"],
        {
          env: {
            ...process.env,
            // O serviço sobe como o systemd o sobe, sem a execução de um agente herdada.
            FABRIQUINHA_EXECUCAO: "",
            // Sem SonarQube, a coleta depois do pi do desenvolvimento falha o ticket; uma reprovação o devolveria ao agente.
            SONAR_HOST_URL: "",
            FABRIQUINHA_ROOT: raiz,
            FABRIQUINHA_PORTA: "0",
            FABRIQUINHA_PI: pi,
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
      atuais.push({ servico, stderr: () => log });
      // O `web.url` nasce inteiro (escrito ao lado e renomeado): existir basta.
      const arquivo = join(raiz, "web.url");
      for (let i = 0; !existsSync(arquivo); i++) {
        if (servico.exitCode !== null || i > 200) throw new Error(`a Fabriquinha não subiu:\n${log}`);
        await dormir(50);
      }
      return { servico, link: readFileSync(arquivo, "utf8"), stderr: () => log };
    }
    const atuais: { servico: ChildProcess; stderr: () => string }[] = [];
    try {
      const inicial = await subir();
      const link = inicial.link;
      await use({
        raiz,
        base: new URL(link).origin,
        link,
        servico: inicial.servico,
        stderr: inicial.stderr,
        reiniciar: async () => {
          const nova = await subir();
          return { base: new URL(nova.link).origin, link: nova.link };
        },
      });
    } finally {
      for (const { servico } of atuais) await parar(servico);
      matarPi(raiz);
      const log = atuais.map((a) => a.stderr()).join("");
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

/** O print da página inteira, gravado na saída do teste (test-results/) e anexado ao relatório. */
export async function fotografar(pagina: Page, info: TestInfo, nome: string): Promise<void> {
  const path = info.outputPath(`${nome}.png`);
  await pagina.screenshot({ fullPage: true, path });
  await info.attach(nome, { path, contentType: "image/png" });
}

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
    sonar: { projectKey: "loja" },
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

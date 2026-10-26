// Git real e isolado: compartilhado somente pelos testes das novas worktrees.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-demandas-")));
after(() => {
  rmSync(temporario, { recursive: true, force: true });
});
const config = join(temporario, "gitconfig");
writeFileSync(config, "[user]\n name = Teste\n email = teste@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = config;
process.env.GIT_CONFIG_NOSYSTEM = "1";

export const gitCenario = (cwd: string, ...args: string[]): string =>
  execFileSync("/usr/bin/git", args, { cwd, stdio: "pipe" }).toString().trim();

export function commitarCenario(repo: string, arquivo: string, conteudo: string): string {
  writeFileSync(join(repo, arquivo), conteudo);
  gitCenario(repo, "add", arquivo);
  gitCenario(repo, "commit", "-q", "-m", arquivo);
  return gitCenario(repo, "rev-parse", "HEAD");
}

export function cenarioDemanda(preparacao: string[] = [], branchBase = "integracao") {
  const dir = mkdtempSync(join(temporario, "cenario-"));
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const raiz = join(dir, "raiz");
  mkdirSync(raiz);
  gitCenario(dir, "init", "-q", "--bare", bare);
  gitCenario(dir, "clone", "-q", bare, repo);
  gitCenario(repo, "checkout", "-q", "-b", branchBase);
  commitarCenario(repo, "base.txt", "base\n");
  gitCenario(repo, "push", "-q", "origin", branchBase);
  return {
    dir,
    bare,
    repo,
    raiz,
    log: join(raiz, "log"),
    projeto: { nome: "loja", repo, branchBase, preparacao },
  };
}

// Git real e isolado do git do operador: cada repositório de teste leva o seu próprio diretório e a sua identidade.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const diretoriosAbertos = new Set<string>();
// Os testes não precisam chamar `fechar()`: o que sobrar é apagado ao fim do processo de teste.
process.on("exit", () => {
  for (const dir of diretoriosAbertos) rmSync(dir, { recursive: true, force: true });
});

const IDENTIDADE_DE_TESTE = ["user.name=Teste", "user.email=teste@exemplo.com"];

/** O ambiente de um processo git que não lê o gitconfig do operador nem o do sistema; vale por chamada, não é global. */
export const AMBIENTE_GIT_ISOLADO = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } as const;

/** Roda o git em `cwd`, com a identidade de teste e sem o gitconfig do operador; devolve a saída sem a quebra final. */
export const rodarGit = (cwd: string, ...args: string[]): string =>
  execFileSync("/usr/bin/git", [...IDENTIDADE_DE_TESTE.flatMap((c) => ["-c", c]), ...args], {
    cwd,
    stdio: "pipe",
    env: { ...process.env, ...AMBIENTE_GIT_ISOLADO },
  })
    .toString()
    .trim();

/** Grava `arquivo` em `repo`, faz o commit e devolve o SHA. */
export function commitarArquivo(repo: string, arquivo: string, conteudo: string): string {
  writeFileSync(join(repo, arquivo), conteudo);
  rodarGit(repo, "add", arquivo);
  rodarGit(repo, "commit", "-q", "-m", arquivo);
  return rodarGit(repo, "rev-parse", "HEAD");
}

/**
 * Um `origin` bare e um clone com a branch base já publicada, mais a raiz da Fabriquinha (vazia) e o projeto `loja`
 * apontando para o clone. O clone leva a identidade de teste no próprio config, que as suas worktrees herdam; assim o
 * código de produção, que roda o git com o ambiente do processo, também consegue commitar.
 */
export function criarRepositorioDeTeste(comandosDePreparacao: string[] = [], branchBase = "integracao") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-repositorio-")));
  diretoriosAbertos.add(dir);
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const raiz = join(dir, "raiz");
  mkdirSync(raiz);
  rodarGit(dir, "init", "-q", "--bare", bare);
  rodarGit(dir, "clone", "-q", bare, repo);
  for (const c of IDENTIDADE_DE_TESTE) rodarGit(repo, "config", ...c.split("="));
  rodarGit(repo, "checkout", "-q", "-b", branchBase);
  commitarArquivo(repo, "base.txt", "base\n");
  rodarGit(repo, "push", "-q", "origin", branchBase);
  return {
    dir,
    bare,
    repo,
    raiz,
    log: join(raiz, "log"),
    projeto: {
      nome: "loja",
      raiz_git: repo,
      branch_base: branchBase,
      hospedagem: "github" as const,
      verificacoes: { preparacao: comandosDePreparacao, fitness: [], linguagens: [], e2e: [], globs: [] },
    },
    /** Apaga tudo o que o repositório criou, worktrees incluídas. */
    fechar: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// O apoio de teste do Repositório: as worktrees, os commits e os PRs como o cenário os monta, sem passar pela
// interface `RepositorioDoProjeto` (que aloca o Ambiente e varre a base), e o git do clone que lança na falha.
export {
  gravarCommitDemanda,
  commitDoTicketDemanda,
} from "../src/modulos/repositorio/commits/armazenamento/commits_demanda.ts";
export { cursorDaBase } from "../src/modulos/repositorio/commits/armazenamento/commits_humanos.ts";
export { pendenciasDeLimpeza } from "../src/modulos/repositorio/espaco_de_trabalho/infra/limpeza_demanda.ts";
export {
  caminhoDaWorktreeDemanda,
  caminhoDaWorktreeRodada,
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
} from "../src/modulos/repositorio/espaco_de_trabalho/infra/worktree-demanda.ts";
export { exigirGit, exigirGitNoAmbiente } from "../src/modulos/repositorio/git/infra/comandos_git.ts";
export { integrarPR, publicarPRDe } from "../src/modulos/repositorio/hospedagem/infra/pr.ts";
export { ocupanteDoAmbiente } from "../src/modulos/repositorio/espaco_de_trabalho/aplicacao/ambiente_do_espaco.ts";
export { espacoDaRodada } from "../src/modulos/repositorio/espaco_de_trabalho/nucleo/espaco_de_trabalho.ts";

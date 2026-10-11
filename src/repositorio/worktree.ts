// Worktree e branch da issue (F5 §3), descarte das alterações (F5 §3.3) e fila de comandos git (F5 §6).
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Issue } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { executar, git } from "../processo.ts";

const LIMITE_PREPARACAO_MS = 30 * 60_000;

/** `<raiz>/worktrees/<projeto>/I-<n>` (F5 §3): fora do repositório, para o test runner dele não varrer worktrees. */
export const caminhoDaWorktree = (raiz: string, projeto: string, issue: number): string =>
  join(raiz, "worktrees", projeto, `I-${String(issue)}`);

const filas = new Map<string, Promise<unknown>>();

/** Roda `trabalho` depois de tudo o que já está na fila `chave`, mesmo que algo antes tenha falhado. */
function naFila<T>(chave: string, trabalho: () => Promise<T>): Promise<T> {
  const vez = (filas.get(chave) ?? Promise.resolve()).then(trabalho);
  filas.set(
    chave,
    vez.catch(() => undefined),
  );
  return vez;
}

/**
 * F5 §6: os comandos git de um projeto passam por aqui, em série. A chave é a pasta das worktrees do projeto,
 * `<raiz>/worktrees/<nome>`, a mesma a que o descarte chega pela worktree sem rodar git.
 * ponytail: fila em memória, válida porque há uma instância só do serviço (D10).
 */
export const naFilaDoProjeto = <T>(raiz: string, nome: string, trabalho: () => Promise<T>): Promise<T> =>
  naFila(dirname(resolve(caminhoDaWorktree(raiz, nome, 0))), trabalho);

/** `git` que lança ErroDeRegra com o stderr quando o comando falha. */
async function exigirGit(dir: string, ...args: string[]): Promise<string> {
  const r = await git(dir, ...args);
  if (r.codigo !== 0) {
    throw new ErroDeRegra(
      `git ${args.join(" ")} falhou em ${dir}: ${r.erro.trim()}`,
      "corrija o repositório e execute o ticket de novo",
    );
  }
  return r.saida;
}

/** Uma linha com horário no log da execução (`<raiz>/execucoes/E-<n>/log`, criado pelo F4). */
const anotar = (log: string, texto: string): void => {
  appendFileSync(log, `${new Date().toISOString()} ${texto}\n`);
};

/**
 * F5 §3.1: devolve o caminho da worktree da issue, criando-a (ou recriando, se a pasta foi apagada) e preparando-a
 * quando ela acabou de nascer ou a última preparação falhou. `log` é o arquivo de log da execução que pediu.
 * `varrerBase` é o gancho do F6 (4.4), chamado quando a base foi buscada; a falha dele só vai para o log.
 */
export async function garantirWorktree(
  raiz: string,
  projeto: Pick<Projeto, "nome" | "repo" | "branchBase" | "preparacao">,
  issue: Pick<Issue, "id" | "criadaEm">,
  log: string,
  varrerBase?: () => Promise<void>,
): Promise<string> {
  const { repo, branchBase } = projeto;
  const caminho = caminhoDaWorktree(raiz, projeto.nome, issue.id);
  const branch = `fabriquinha/I-${String(issue.id)}`;
  // Posse da branch, na config dela: o caminho (raiz e número) e a criação da issue a identificam nesta instalação.
  // `git branch -D` apaga a config junto, então a branch removida pelo Auditor some com a marca.
  const dono = `${caminho} ${issue.criadaEm}`;

  const { buscouBase, marca } = await naFilaDoProjeto(raiz, projeto.nome, async () => {
    let buscouBase = false;
    if ((await exigirGit(repo, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`)) === "") {
      // Refspec explícita: um branchBase começando com "-" nunca vira opção do git.
      await exigirGit(repo, "fetch", "origin", `+refs/heads/${branchBase}:refs/remotes/origin/${branchBase}`);
      buscouBase = true;
      // A marca vem antes da branch: se o processo morrer entre as duas, a branch não fica órfã de dono.
      await exigirGit(repo, "config", `branch.${branch}.fabriquinha`, dono);
      await exigirGit(repo, "worktree", "add", "-b", branch, caminho, `refs/remotes/origin/${branchBase}`);
    } else {
      if ((await exigirGit(repo, "config", "--default", "", "--get", `branch.${branch}.fabriquinha`)).trim() !== dono) {
        throw new ErroDeRegra(
          `a branch ${branch} já existe em ${repo} e não pertence à I-${String(issue.id)} desta Fabriquinha`,
          `se for sobra, remova-a com git -C ${repo} branch -D ${branch}; a Fabriquinha nunca a sobrescreve`,
        );
      }
      if (!existsSync(caminho)) {
        await exigirGit(repo, "worktree", "prune");
        await exigirGit(repo, "worktree", "add", caminho, branch);
      }
    }
    // A marca de preparada mora nos metadados da worktree (.git/worktrees/I-<n>/): some no prune, longe do clean.
    const marca = (
      await exigirGit(caminho, "rev-parse", "--path-format=absolute", "--git-path", "fabriquinha-preparada")
    ).trim();
    return { buscouBase, marca };
  });

  if (buscouBase && varrerBase) {
    try {
      await varrerBase();
    } catch (error_) {
      anotar(log, `varrerBase falhou: ${String(error_)}`);
    }
  }
  if (!existsSync(marca)) {
    await preparar(caminho, projeto.preparacao, log);
    writeFileSync(marca, "");
  }
  return caminho;
}

/** F5 §3.2: cada comando com /bin/sh -c, na worktree, em ordem, parando no primeiro que falhar. Fora da fila git. */
async function preparar(caminho: string, comandos: readonly string[], log: string): Promise<void> {
  for (const comando of comandos) {
    anotar(log, `preparação: ${comando}`);
    const r = await executar("/bin/sh", ["-c", comando], { cwd: caminho, limiteMs: LIMITE_PREPARACAO_MS });
    // ponytail: stdout e depois stderr, não intercalados; um descritor do log como stdio do filho intercalaria.
    appendFileSync(log, r.saida + r.erro);
    if (r.codigo !== 0) {
      const motivo = r.limiteEstourado ? "passou de 30 minutos" : `saiu com código ${String(r.codigo)}`;
      anotar(log, `preparação falhou: ${motivo}`);
      throw new ErroDeRegra(
        `a preparação da worktree falhou em "${comando}": ${motivo}`,
        `veja o log em ${log}; ela roda de novo na próxima execução`,
      );
    }
  }
}

/**
 * F5 §3.3: `reset --hard HEAD` e `clean -fd` (sem `-x`: o que o .gitignore ignora, como `node_modules`, fica).
 * Devolve o que o clean removeu (pasta inteira com `/` no fim) e, se removeu algo, anota a lista no log.
 */
export async function descartarAlteracoes(worktree: string, log: string): Promise<string[]> {
  const removidos = await naFila(dirname(resolve(worktree)), async () => {
    await exigirGit(worktree, "reset", "-q", "--hard", "HEAD");
    // ponytail: quotePath=false deixa acento legível; nome com aspas, barra invertida ou controle ainda vem entre aspas.
    const saida = await exigirGit(worktree, "-c", "core.quotePath=false", "clean", "-fd");
    return saida
      .split("\n")
      .filter((linha) => linha.startsWith("Removing "))
      .map((linha) => linha.slice("Removing ".length));
  });
  if (removidos.length > 0) anotar(log, `descarte removeu: ${removidos.join(", ")}`);
  return removidos;
}

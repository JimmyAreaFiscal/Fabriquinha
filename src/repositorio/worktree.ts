// Worktree e branch da issue (F5 §3), descarte das alterações (F5 §3.3), limpeza depois do encerramento (F5 §5.3) e
// fila de comandos git (F5 §6).
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Issue } from "../dominio/agregado.ts";
import { ErroDeRegra, mensagem } from "../dominio/erros.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { anotar, noLog } from "../persistencia/execucoes.ts";
import { executarNoShell, git, LIMITE_COMANDO_MS } from "../processo.ts";

/**
 * Bytes do fim do log de cada comando de preparação.
 * ponytail: o corte só protege a memória do serviço; o log da execução não tem limite de tamanho (F5 §3.2).
 */
const LIMITE_LOG_PREPARACAO = 5 * 1024 * 1024;

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
export async function exigirGit(dir: string, ...args: string[]): Promise<string> {
  const r = await git(dir, ...args);
  if (r.codigo !== 0) {
    throw new ErroDeRegra(
      `git ${args.join(" ")} falhou em ${dir}: ${r.erro.trim()}`,
      "corrija o repositório e execute o ticket de novo",
    );
  }
  return r.saida;
}

/**
 * F5 §3.1: devolve o caminho da worktree da issue, criando-a (ou recriando, se a pasta foi apagada) e preparando-a
 * quando ela acabou de nascer ou a última preparação falhou. `log` é o arquivo de log da execução que pediu.
 * `varrerBase` é o gancho do F6 (4.4), chamado quando a base foi buscada; a falha dele só vai para o log. Obrigatório:
 * quem cria worktree sem ele perderia os commits humanos sem o compilador acusar.
 */
export async function garantirWorktree(
  raiz: string,
  projeto: Pick<Projeto, "nome" | "repo" | "branchBase" | "preparacao">,
  issue: Pick<Issue, "id" | "criadaEm">,
  log: string,
  varrerBase: () => Promise<void>,
  atualizarBase = false,
): Promise<string> {
  const { repo, branchBase } = projeto;
  const caminho = caminhoDaWorktree(raiz, projeto.nome, issue.id);
  const branch = `fabriquinha/I-${String(issue.id)}`;
  // Posse da branch, na config dela: o caminho (raiz e número) e a criação da issue a identificam nesta instalação.
  // `git branch -D` apaga a config junto, então a branch removida pelo Auditor some com a marca.
  const dono = `${caminho} ${issue.criadaEm}`;

  const { buscouBase, marca, mudouHead } = await naFilaDoProjeto(raiz, projeto.nome, async () => {
    let buscouBase = false;
    let mudouHead = false;
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
      if (atualizarBase) {
        await exigirGit(repo, "fetch", "origin", `+refs/heads/${branchBase}:refs/remotes/origin/${branchBase}`);
        buscouBase = true;
        const antes = await exigirGit(caminho, "rev-parse", "HEAD");
        const r = await git(caminho, "merge", "--no-edit", `refs/remotes/origin/${branchBase}`);
        if (r.codigo !== 0) {
          await git(caminho, "merge", "--abort");
          throw new ErroDeRegra(
            `o merge de origin/${branchBase} na branch ${branch} falhou: ${(r.saida + r.erro).trim()}`,
            `resolva o conflito com origin/${branchBase} em ${caminho} e execute o ticket de novo`,
          );
        }
        mudouHead = (await exigirGit(caminho, "rev-parse", "HEAD")) !== antes;
      }
    }
    // A marca de preparada mora nos metadados da worktree (.git/worktrees/I-<n>/): some no prune, longe do clean.
    const marca = (
      await exigirGit(caminho, "rev-parse", "--path-format=absolute", "--git-path", "fabriquinha-preparada")
    ).trim();
    return { buscouBase, marca, mudouHead };
  });

  if (buscouBase) {
    try {
      await varrerBase();
    } catch (error_) {
      anotar(log, `varrerBase falhou: ${String(error_)}`);
    }
  }
  // F5 §3.2: o merge que muda o HEAD pode mudar o que a preparação instala.
  if (mudouHead) rmSync(marca, { force: true });
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
    const r = await executarNoShell(comando, caminho, { limiteLog: LIMITE_LOG_PREPARACAO });
    appendFileSync(log, r.log);
    if (r.codigo !== 0) {
      const motivo = r.estourou
        ? `passou de ${String(LIMITE_COMANDO_MS / 60_000)} minutos`
        : `saiu com código ${String(r.codigo)}`;
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

/**
 * F5 §5.3: o comando da limpeza que falhou, para o Auditor rodar. A worktree de uma issue concluída que ainda está no
 * disco é o `worktree remove` que falhou, e rodá-lo também tira a worktree do git; o `prune` que falha depois de um
 * `remove` que passou não deixa nada da issue para trás. Lido do disco a cada vez, o aviso some sozinho quando o
 * Auditor roda o comando.
 * ponytail: nos instantes entre o C16 e o fim do `limpar`, a worktree ainda existe e o aviso aparece; quem relê a
 * página depois já não o vê. A saída do git que falhou fica só na resposta do encerramento; persistir os avisos se o
 * Auditor precisar dela depois.
 */
export function limpezaPendente(
  raiz: string,
  projeto: Pick<Projeto, "nome" | "repo">,
  issue: Pick<Issue, "id" | "fase">,
): string[] {
  const caminho = caminhoDaWorktree(raiz, projeto.nome, issue.id);
  if (issue.fase !== "concluida" || !existsSync(caminho)) return [];
  return [`git -C ${projeto.repo} worktree remove --force ${caminho}`];
}

/**
 * F5 §5.3: avança a base local (`refs/heads/<base>`) até `origin/<base>` só por fast-forward, sem stash, reset nem
 * merge commit. Com a base em checkout, o merge roda na pasta dela; sem checkout, o `update-ref` guarda o sha antigo.
 * Devolve o aviso de por que não avançou, ou `undefined` (avançou, ou não há base local).
 */
async function atualizarBaseLocal(repo: string, base: string): Promise<string | undefined> {
  const ref = `refs/heads/${base}`;
  const origem = `refs/remotes/origin/${base}`;
  const antigo = await git(repo, "rev-parse", "-q", "--verify", ref);
  if (antigo.codigo !== 0) return undefined;
  const naoAtualizada = `a ${base} local não foi atualizada com origin/${base}`;
  const lista = await git(repo, "worktree", "list", "--porcelain");
  const bloco = lista.saida.split("\n\n").find((b) => b.split("\n").includes(`branch ${ref}`));
  if (bloco !== undefined) {
    const pasta = bloco.slice("worktree ".length, bloco.indexOf("\n"));
    const r = await git(pasta, "merge", "--ff-only", "-q", origem);
    return r.codigo === 0 ? undefined : `${naoAtualizada}, em checkout em ${pasta}: ${(r.saida + r.erro).trim()}`;
  }
  if ((await git(repo, "merge-base", "--is-ancestor", ref, origem)).codigo !== 0) {
    return `${naoAtualizada}: ela tem commits que origin/${base} não tem; atualize-a à mão`;
  }
  const r = await git(repo, "update-ref", ref, origem, antigo.saida.trim());
  return r.codigo === 0 ? undefined : `${naoAtualizada}: ${r.erro.trim()}`;
}

/**
 * F5 §5.3, depois de C16 aprovado: `varrerBase`, o gancho do F6 (§4.4) que busca a base e varre os commits humanos,
 * cuja falha só vai para o log; depois remove a worktree, faz prune e avança a base local até `origin/<base>`. As
 * branches da issue, local e remota, ficam. Devolve um aviso por comando que falhou e o da base local, se ela não
 * avançou: a limpeza não desfaz o encerramento. O gancho entra na fila do projeto sozinho, por isso roda fora dela aqui.
 */
export async function limpar(
  raiz: string,
  projeto: Pick<Projeto, "nome" | "repo" | "branchBase">,
  issue: Pick<Issue, "id" | "fase">,
  varrerBase: () => Promise<void>,
): Promise<string[]> {
  const i = `I-${String(issue.id)}`;
  if (issue.fase !== "concluida") {
    throw new ErroDeRegra(`a ${i} está na fase ${issue.fase}`, "a worktree só é removida depois de encerrar a issue");
  }
  try {
    await varrerBase();
  } catch (error_) {
    noLog(`varrerBase ao limpar a ${i} falhou: ${mensagem(error_)}`);
  }
  const caminho = caminhoDaWorktree(raiz, projeto.nome, issue.id);
  return naFilaDoProjeto(raiz, projeto.nome, async () => {
    const avisos: string[] = [];
    for (const args of [
      ["worktree", "remove", "--force", caminho],
      ["worktree", "prune"],
    ]) {
      const r = await git(projeto.repo, ...args);
      if (r.codigo !== 0) avisos.push(`git -C ${projeto.repo} ${args.join(" ")} falhou: ${r.erro.trim()}`);
    }
    const base = await atualizarBaseLocal(projeto.repo, projeto.branchBase);
    if (base !== undefined) avisos.push(base);
    return avisos;
  });
}

/**
 * Remoção do projeto: apaga `<raiz>/worktrees/<projeto>` inteira e faz `git worktree prune` no repositório, que só
 * recebe o prune (arquivos, commits, branches `fabriquinha/I-n` e remoto ficam). Como `limpar`, devolve um aviso por
 * falha e nunca lança por causa do disco ou do git.
 */
export function removerWorktrees(raiz: string, projeto: Pick<Projeto, "nome" | "repo">): Promise<string[]> {
  return naFilaDoProjeto(raiz, projeto.nome, async () => {
    const avisos: string[] = [];
    const pasta = dirname(caminhoDaWorktree(raiz, projeto.nome, 0));
    try {
      await rm(pasta, { recursive: true, force: true });
    } catch (error_) {
      avisos.push(`não foi possível apagar ${pasta}: ${mensagem(error_)}`);
    }
    const r = await git(projeto.repo, "worktree", "prune");
    if (r.codigo !== 0) avisos.push(`git -C ${projeto.repo} worktree prune falhou: ${r.erro.trim()}`);
    return avisos;
  });
}

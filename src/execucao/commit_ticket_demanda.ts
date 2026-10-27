// Commit do ticket da demanda (comparacao-sdlc-implementacao.md §6), idempotente pela marca `[I-n.Tm]` na mensagem.
import type { DatabaseSync } from "node:sqlite";
import { formatarTicketRef } from "../dominio/demanda.ts";
import { type Commit } from "../persistencia/commits.ts";
import { gravarCommitDemanda } from "../persistencia/commits_demanda.ts";
import { arquivosDe, commitar } from "../repositorio/commit.ts";
import { exigirGit } from "../repositorio/worktree.ts";
import { git, LIMITE_COMANDO_MS } from "../processo.ts";

type Ref = Parameters<typeof formatarTicketRef>[0];

const marcaDe = (ref: Ref) => `[${formatarTicketRef(ref)}]`;

/** `-M` explícito e, num merge, o diff contra o primeiro pai (a branch da rodada), não o combinado. */
async function lerCommit(worktree: string, sha: string): Promise<Commit> {
  const mudou = (formato: string) =>
    exigirGit(worktree, "show", "-z", "-M", "--diff-merges=first-parent", formato, "--format=", sha);
  return {
    sha,
    mensagem: (await exigirGit(worktree, "show", "-s", "--format=%B", sha)).trimEnd(),
    em: (await exigirGit(worktree, "show", "-s", "--format=%cI", sha)).trim(),
    arquivos: arquivosDe(await mudou("--name-status"), await mudou("--numstat")),
  };
}

/** O commit da worktree cuja mensagem tem a marca do ticket, ou `undefined`. */
export async function acharCommitTicketDemanda(worktree: string, ref: Ref): Promise<Commit | undefined> {
  const marca = marcaDe(ref);
  const sha = (await exigirGit(worktree, "log", "--fixed-strings", "--grep", marca, "--format=%H")).split("\n")[0];
  return sha ? lerCommit(worktree, sha) : undefined;
}

/**
 * `git add -A` e commit `feat|fix: <título> [I-n.Tm]` com os hooks e sem credenciais; se o commit do ticket já
 * existe (queda antes da gravação), reaproveita. Grava o commit e os arquivos e o devolve.
 * No `resolver_conflito`, o commit conclui o merge em andamento na worktree.
 */
export async function commitarTicketDemanda(
  banco: DatabaseSync,
  ref: Ref,
  { worktree, tipo, titulo }: { worktree: string; tipo: "feat" | "fix"; titulo: string },
  limiteMs = LIMITE_COMANDO_MS,
): Promise<Commit> {
  let commit = await acharCommitTicketDemanda(worktree, ref);
  if (!commit) {
    await exigirGit(worktree, "add", "-A");
    const semAlteracao = (await git(worktree, "diff", "--cached", "--quiet")).codigo === 0;
    await commitar(worktree, `${tipo}: ${titulo} ${marcaDe(ref)}`, { emendar: false, semAlteracao }, limiteMs);
    commit = await lerCommit(worktree, (await exigirGit(worktree, "rev-parse", "HEAD")).trim());
  }
  gravarCommitDemanda(banco, ref.demanda_id, ref.ticket_id, commit);
  return commit;
}

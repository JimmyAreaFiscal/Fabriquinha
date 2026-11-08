// Commit do ticket da demanda (comparacao-sdlc-implementacao.md §6), idempotente pela marca `[I-n.Tm]` na mensagem.
import type { DatabaseSync } from "node:sqlite";
import type { TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { formatarTicketRef } from "../nucleo/demanda.ts";
import { ErroDeReprovacao } from "../nucleo/erros.ts";
import { registrarRetrabalhoDemanda } from "./retrabalho.ts";
import { noLog } from "../infra/registro.ts";
import type { Commit } from "../armazenamento/commits.ts";
import { gravarCommitDemanda } from "../armazenamento/commits_demanda.ts";
import { arquivosDe, commitar } from "../infra/repositorio/commit.ts";
import { exigirGit } from "../infra/repositorio/worktree.ts";
import type { Ambiente } from "../infra/ambiente/ambiente.ts";
import { git, LIMITE_COMANDO_MS } from "../infra/processo.ts";

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
 * No `resolver_conflito`, o commit conclui o merge em andamento na worktree, mesmo sem alteração; o `implementar`
 * sem alteração não gera commit vazio e é rejeitado com `ErroDeReprovacao`.
 */
export async function commitarTicketDemanda(
  banco: DatabaseSync,
  ref: Ref,
  {
    ambiente,
    worktree,
    tipo,
    titulo,
    etapa,
  }: { ambiente: Ambiente; worktree: string; tipo: "feat" | "fix"; titulo: string; etapa: TicketDemanda["etapa"] },
  limiteMs = LIMITE_COMANDO_MS,
): Promise<Commit> {
  let commit = await acharCommitTicketDemanda(worktree, ref);
  if (!commit) {
    await exigirGit(worktree, "add", "-A");
    const semAlteracao = (await git(worktree, "diff", "--cached", "--quiet")).codigo === 0;
    if (semAlteracao && etapa === "implementar") {
      throw new ErroDeReprovacao(
        `o ticket ${formatarTicketRef(ref)} terminou sem alteração na worktree e não gera commit vazio: faça nos arquivos da worktree a correção que o ticket pede; o corpo do PR nasce da mensagem do PR no encerramento da rodada e não muda nesta etapa`,
      );
    }
    await commitar(
      ambiente,
      worktree,
      `${tipo}: ${titulo} ${marcaDe(ref)}`,
      { emendar: false, semAlteracao },
      limiteMs,
    );
    commit = await lerCommit(worktree, (await exigirGit(worktree, "rev-parse", "HEAD")).trim());
  }
  gravarCommitDemanda(banco, ref.demanda_id, ref.ticket_id, commit);
  // O retrabalho do commit do ticket (F6 §4.2); a falha só vai para o log.
  await registrarRetrabalhoDemanda(banco, ref.demanda_id, ref.ticket_id, commit.sha).catch(noLog);
  return commit;
}

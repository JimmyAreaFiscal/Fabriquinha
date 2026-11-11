// Commit do ticket da demanda (comparacao-sdlc-implementacao.md §6), idempotente pela marca `[I-n.Tm]` na mensagem.
import type { DatabaseSync } from "node:sqlite";
import type { TicketDemanda } from "../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { formatarTicketRef } from "../../../sdlc/nucleo/demanda/demanda.ts";
import { ErroDeReprovacao } from "../../../compartilhado/nucleo/erros.ts";
import { registrarCommitsHumanosDoTicket } from "../../../custos/aplicacao/metricas/varrer_commits_humanos.ts";
import { noLog } from "../../../compartilhado/infra/registro.ts";
import type { Commit } from "../../nucleo/commits.ts";
import { gravarCommitDemanda } from "../../../sdlc/armazenamento/commits_demanda.ts";
import { arquivosDe, commitar } from "../../infra/git/commit.ts";
import { exigirGitNoAmbiente, gitNoAmbiente } from "../../infra/worktree/worktree.ts";
import { type Ambiente, LIMITE_COMANDO_MS } from "../../../sandbox/infra/ambiente.ts";
import { PRIMEIRA_ETAPA_DA_RODADA } from "../../../sdlc/nucleo/ciclo_de_vida/ciclos.ts";

type Ref = Parameters<typeof formatarTicketRef>[0];

const marcaDe = (ref: Ref) => `[${formatarTicketRef(ref)}]`;

/** `-M` explícito e, num merge, o diff contra o primeiro pai (a branch da rodada), não o combinado. */
async function lerCommit(ambiente: Ambiente, worktree: string, sha: string): Promise<Commit> {
  const mudou = (formato: string) =>
    exigirGitNoAmbiente(
      ambiente,
      worktree,
      "show",
      "-z",
      "-M",
      "--diff-merges=first-parent",
      formato,
      "--format=",
      sha,
    );
  return {
    sha,
    mensagem: (await exigirGitNoAmbiente(ambiente, worktree, "show", "-s", "--format=%B", sha)).trimEnd(),
    em: (await exigirGitNoAmbiente(ambiente, worktree, "show", "-s", "--format=%cI", sha)).trim(),
    arquivos: arquivosDe(await mudou("--name-status"), await mudou("--numstat")),
  };
}

/** O commit da worktree cuja mensagem tem a marca do ticket, ou `undefined`. */
export async function acharCommitTicketDemanda(
  ambiente: Ambiente,
  worktree: string,
  ref: Ref,
): Promise<Commit | undefined> {
  const marca = marcaDe(ref);
  const sha = (
    await exigirGitNoAmbiente(ambiente, worktree, "log", "--fixed-strings", "--grep", marca, "--format=%H")
  ).split("\n")[0];
  return sha ? lerCommit(ambiente, worktree, sha) : undefined;
}

/**
 * `git add -A` e commit `feat|fix: <título> [I-n.Tm]` com os hooks e sem credenciais; se o commit do ticket já
 * existe (queda antes da gravação), reaproveita. Grava o commit e os arquivos e o devolve.
 * Na resolução do conflito, o commit conclui o merge em andamento na worktree, mesmo sem alteração; o ticket do Plano
 * (a primeira Etapa da rodada) sem alteração não gera commit vazio e é rejeitado com `ErroDeReprovacao`.
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
  let commit = await acharCommitTicketDemanda(ambiente, worktree, ref);
  if (!commit) {
    await exigirGitNoAmbiente(ambiente, worktree, "add", "-A");
    const semAlteracao = (await gitNoAmbiente(ambiente, worktree, "diff", "--cached", "--quiet")).codigo === 0;
    if (semAlteracao && etapa === PRIMEIRA_ETAPA_DA_RODADA) {
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
    commit = await lerCommit(
      ambiente,
      worktree,
      (await exigirGitNoAmbiente(ambiente, worktree, "rev-parse", "HEAD")).trim(),
    );
  }
  gravarCommitDemanda(banco, ref.demanda_id, ref.ticket_id, commit);
  // Os commits posteriores do commit do ticket (F6 §4.2); a falha só vai para o log.
  await registrarCommitsHumanosDoTicket(banco, ref.demanda_id, ref.ticket_id, commit.sha).catch(noLog);
  return commit;
}

// Commit do ticket (comparacao-sdlc-implementacao.md §6), idempotente pela marca do ticket na mensagem: o Ciclo de Vida
// diz a marca, a mensagem e se o commit sem alteração é recusado; o Repositório roda o git no Ambiente do Espaço e grava.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeReprovacao } from "../../../../shared/nucleo/erros.ts";
import { noLog } from "../../../../shared/infra/registro.ts";
import type { Ambiente } from "../../../ambiente/publico.ts";
import { exigirGitNoAmbiente, gitNoAmbiente, type ProjetoDoRepositorio } from "../../git/publico.ts";
import { gravarCommitDemanda } from "../armazenamento/commits_demanda.ts";
import { arquivosDe, commitar } from "../infra/commit.ts";
import type { Commit } from "../nucleo/commits.ts";
import { registrarCommitsHumanosDoTicket } from "./varredura_de_commits_humanos.ts";

/** O que o commit do ticket leva: o dono, a marca que o identifica na mensagem e a mensagem, que já traz a marca. */
export interface PedidoDeCommit {
  demanda_id: string;
  ticket_id: number;
  marca: string;
  mensagem: string;
  /** Com ela, o ticket sem alteração na worktree é recusado com `ErroDeReprovacao` e este motivo, sem commit vazio. */
  recusaSemAlteracao?: string;
}

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

/** O commit da worktree cuja mensagem tem a `marca`, ou `undefined`. @testes o teste confere a busca pela marca; a produção a usa só no commit */
export async function acharCommitComMarca(
  ambiente: Ambiente,
  worktree: string,
  marca: string,
): Promise<Commit | undefined> {
  const sha = (
    await exigirGitNoAmbiente(ambiente, worktree, "log", "--fixed-strings", "--grep", marca, "--format=%H")
  ).split("\n")[0];
  return sha ? lerCommit(ambiente, worktree, sha) : undefined;
}

/**
 * `git add -A` e commit com a mensagem do pedido, com os hooks e sem credenciais; se o commit com a marca já existe
 * (queda antes da gravação), reaproveita. Grava o commit e os arquivos e o devolve. Sem alteração, o commit conclui o
 * merge em andamento na worktree (resolução do conflito), salvo com `recusaSemAlteracao`.
 */
export async function commitarTicket(
  banco: DatabaseSync,
  ambiente: Ambiente,
  worktree: string,
  projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git">,
  pedido: PedidoDeCommit,
  limiteMs: number,
): Promise<Commit> {
  let commit = await acharCommitComMarca(ambiente, worktree, pedido.marca);
  if (!commit) {
    await exigirGitNoAmbiente(ambiente, worktree, "add", "-A");
    const semAlteracao = (await gitNoAmbiente(ambiente, worktree, "diff", "--cached", "--quiet")).codigo === 0;
    if (semAlteracao && pedido.recusaSemAlteracao !== undefined) throw new ErroDeReprovacao(pedido.recusaSemAlteracao);
    await commitar(ambiente, worktree, pedido.mensagem, { emendar: false, semAlteracao }, limiteMs);
    commit = await lerCommit(
      ambiente,
      worktree,
      (await exigirGitNoAmbiente(ambiente, worktree, "rev-parse", "HEAD")).trim(),
    );
  }
  gravarCommitDemanda(banco, pedido.demanda_id, pedido.ticket_id, commit);
  // Os commits posteriores do commit do ticket (F6 §4.2); a falha só vai para o log.
  await registrarCommitsHumanosDoTicket(banco, projeto, pedido.demanda_id, pedido.ticket_id, commit.sha).catch(noLog);
  return commit;
}

// Passo git da migração das issues em andamento (comparacao-sdlc-implementacao.md §10): a branch da issue vira a da
// rodada 1 e a da demanda volta à base. Roda depois do commit do banco e é idempotente; nada vai ao remoto.
import { existsSync } from "node:fs";
import { branchDemanda, branchRodada } from "../dominio/demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { caminhoDaWorktree, exigirGit, naFilaDoProjeto } from "./worktree.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada, verificarLimpa } from "./worktree-demanda.ts";

export interface MigracaoGit {
  issue: string;
  criouRodada: boolean;
  moveuDemanda: boolean;
  removeuWorktree: boolean;
}

/** `emVoo` é o de `Relatorio`; issue sem a branch `fabriquinha/I-n` (ainda sem desenvolvimento) não tem o que migrar. */
export function migrarGitEmVoo(
  raiz: string,
  projeto: Pick<Projeto, "nome" | "repo" | "branchBase">,
  emVoo: readonly { issue: string }[],
): Promise<MigracaoGit[]> {
  const { repo } = projeto;
  const marca = async (branch: string): Promise<string> =>
    (await exigirGit(repo, "config", "--default", "", "--get", `branch.${branch}.fabriquinha`)).trim();
  const existe = async (branch: string): Promise<boolean> =>
    (await exigirGit(repo, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`)).trim() !== "";

  return naFilaDoProjeto(raiz, projeto.nome, async () => {
    const alvos: { issue: string; legada: string; pasta: string }[] = [];
    for (const { issue } of emVoo) {
      const legada = branchDemanda(issue);
      if (!(await existe(legada))) continue;
      const pasta = caminhoDaWorktree(raiz, projeto.nome, Number(issue.slice(2)));
      // Suja: recusa antes de alterar qualquer issue.
      if (existsSync(pasta)) await verificarLimpa(pasta);
      alvos.push({ issue, legada, pasta });
    }

    const resultado: MigracaoGit[] = [];
    for (const { issue, legada, pasta } of alvos) {
      const rodada = branchRodada(issue, 1);
      const donoRodada = `rodada:${caminhoDaWorktreeRodada(raiz, projeto.nome, { demanda_id: issue, rodada_id: 1 })}`;
      const donoDemanda = `demanda:${caminhoDaWorktreeDemanda(raiz, projeto.nome, issue)}`;
      const r: MigracaoGit = { issue, criouRodada: false, moveuDemanda: false, removeuWorktree: false };

      if (await existe(rodada)) {
        if ((await marca(rodada)) !== donoRodada) {
          throw new ErroDeRegra(
            `a branch ${rodada} já existe em ${repo} e não pertence à rodada 1 de ${issue}`,
            `se for sobra, remova-a com git -C ${repo} branch -D ${rodada}; a Fabriquinha nunca a sobrescreve`,
          );
        }
      } else {
        // A marca vem antes da branch, como em garantirWorktree: sem órfã de dono se o processo morrer entre as duas.
        await exigirGit(repo, "config", `branch.${rodada}.fabriquinha`, donoRodada);
        const topo = existsSync(pasta) ? await exigirGit(pasta, "rev-parse", "HEAD") : legada;
        await exigirGit(repo, "branch", rodada, topo.trim());
        r.criouRodada = true;
      }
      if (existsSync(pasta)) {
        await exigirGit(repo, "worktree", "remove", pasta);
        r.removeuWorktree = true;
      }
      // A worktree apagada à mão ainda prende a branch no registro do git.
      await exigirGit(repo, "worktree", "prune");

      if ((await marca(legada)) !== donoDemanda) {
        const base = await exigirGit(
          repo,
          "merge-base",
          `refs/heads/${rodada}`,
          `refs/remotes/origin/${projeto.branchBase}`,
        );
        await exigirGit(repo, "branch", "-f", legada, base.trim());
        await exigirGit(repo, "config", `branch.${legada}.fabriquinha`, donoDemanda);
        r.moveuDemanda = true;
      }
      resultado.push(r);
    }
    return resultado;
  });
}

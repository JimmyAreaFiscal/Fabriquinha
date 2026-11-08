// Ponte até o CicloDoEspaco.criar(): a worktree do Espaço, sem quem chama escolher entre a da demanda e a da rodada.
import type { EspacoDeTrabalho } from "../../nucleo/espaco_de_trabalho.ts";
import type { Projeto } from "../../nucleo/projeto.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../../infra/repositorio/worktree-demanda.ts";

/** Garante a worktree do Espaço e devolve a pasta; só o Espaço da demanda varre a base antes de criar. */
export function garantirWorktreeDoEspaco(
  espaco: EspacoDeTrabalho,
  raiz: string,
  projeto: Pick<Projeto, "nome" | "raiz_git" | "branch_base" | "verificacoes">,
  log: string,
  varrerBase: () => Promise<void>,
): Promise<string> {
  const { demanda_id, rodada_id } = espaco.dono;
  return rodada_id === undefined
    ? garantirWorktreeDemanda(raiz, projeto, demanda_id, log, varrerBase)
    : garantirWorktreeRodada(raiz, projeto, { demanda_id, rodada_id }, log);
}

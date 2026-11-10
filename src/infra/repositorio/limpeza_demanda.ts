// Limpeza da demanda por posse (comparacao-sdlc-implementacao.md §5, CA-10 a CA-12): só worktrees e branches que a
// Fabriquinha criou para a demanda e as rodadas; a base e qualquer branch alheia nunca entram.
import { existsSync } from "node:fs";
import type { AgregadoDemanda } from "../../nucleo/agregado_demanda.ts";
import { branchDemanda, branchRodada } from "../../nucleo/demanda.ts";
import type { EspacoDeTrabalho } from "../../nucleo/espaco_de_trabalho.ts";
import type { Projeto } from "../../nucleo/projeto.ts";
import type { Ambiente } from "../ambiente/ambiente.ts";
import { git } from "../processo.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "./worktree-demanda.ts";
import { exigirGit, exigirGitNoAmbiente, gitNoAmbiente, naFilaDoProjeto } from "./worktree.ts";

type ProjetoLimpeza = Pick<Projeto, "nome" | "raiz_git">;

const refRemota = async (repo: string, branch: string): Promise<boolean> =>
  (await exigirGit(repo, "ls-remote", "--heads", "origin", `refs/heads/${branch}`)).trim() !== "";
const refLocal = async (ambiente: Ambiente, repo: string, branch: string): Promise<boolean> =>
  (await exigirGitNoAmbiente(ambiente, repo, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`)).trim() !==
  "";
const partir = (item: string): [string, string] => {
  const i = item.indexOf(":");
  return [item.slice(0, i), item.slice(i + 1)];
};

const pendenciaDaWorktree = (caminho: string): string[] => (existsSync(caminho) ? [`worktree:${caminho}`] : []);

/** `branch_local:<nome>` e `branch_remota:<nome>` da branch que a Fabriquinha criou; a posse vive na config da branch local. */
async function pendenciasDaBranch(ambiente: Ambiente, raizGit: string, branch: string): Promise<string[]> {
  // A posse mora na config do clone, que o container vê congelada e só em leitura: quem a lê e a apaga é o core.
  const posse = await exigirGit(raizGit, "config", "--default", "", "--get", `branch.${branch}.fabriquinha`);
  if (posse.trim() === "") return [];
  const pendentes: string[] = [];
  if (await refLocal(ambiente, raizGit, branch)) pendentes.push(`branch_local:${branch}`);
  if (await refRemota(raizGit, branch)) pendentes.push(`branch_remota:${branch}`);
  return pendentes;
}

/** O que o Espaço de Trabalho ainda deixa: a worktree e as branches que a Fabriquinha criou para ele. */
export async function pendenciasDoEspaco(
  ambiente: Ambiente,
  projeto: ProjetoLimpeza,
  espaco: Pick<EspacoDeTrabalho, "pasta" | "branch">,
): Promise<string[]> {
  return [
    ...pendenciaDaWorktree(espaco.pasta),
    ...(await pendenciasDaBranch(ambiente, projeto.raiz_git, espaco.branch)),
  ];
}

/** O que a demanda ainda deixa: `worktree:<caminho>`, `branch_local:<nome>` e `branch_remota:<nome>`. */
export async function pendenciasDeLimpeza(
  ambiente: Ambiente,
  raiz: string,
  projeto: ProjetoLimpeza,
  ag: Pick<AgregadoDemanda, "demanda" | "rodadas">,
): Promise<string[]> {
  const id = ag.demanda.id;
  const pendentes = [
    ...ag.rodadas.map((r) => caminhoDaWorktreeRodada(raiz, projeto.nome, { demanda_id: id, rodada_id: r.rodada_id })),
    caminhoDaWorktreeDemanda(raiz, projeto.nome, id),
  ].flatMap(pendenciaDaWorktree);
  for (const branch of [...ag.rodadas.map((r) => branchRodada(id, r.rodada_id)), branchDemanda(id)]) {
    pendentes.push(...(await pendenciasDaBranch(ambiente, projeto.raiz_git, branch)));
  }
  return pendentes;
}

async function executar(ambiente: Ambiente, repo: string, tipo: string, alvo: string): Promise<boolean> {
  if (tipo === "worktree") {
    await gitNoAmbiente(ambiente, repo, "worktree", "remove", "--force", alvo);
    await gitNoAmbiente(ambiente, repo, "worktree", "prune");
    return !existsSync(alvo);
  }
  if (tipo === "branch_local") {
    await git(repo, "branch", "-D", alvo);
    return !(await refLocal(ambiente, repo, alvo));
  }
  if (tipo === "branch_remota") {
    // Já ausente conta como feito.
    if (await refRemota(repo, alvo)) await git(repo, "push", "origin", "--delete", alvo);
    return !(await refRemota(repo, alvo));
  }
  return false;
}

/**
 * Executa só as pendências recebidas, em série na fila git do projeto. Um item que falha não impede os demais.
 * Ordem: worktrees das rodadas, worktree da demanda, remotas e locais. As remotas vão antes das locais porque a
 * posse que as identifica some junto com `branch -D`: uma remota que falhou ainda é reconhecida na reabertura.
 */
export function limparDemanda(
  ambiente: Ambiente,
  raiz: string,
  projeto: ProjetoLimpeza,
  pendentes: readonly string[],
): Promise<{ removidos: string[]; pendentes: string[] }> {
  const ordem = ["worktree", "branch_remota", "branch_local"];
  const posicao = (item: string): number => {
    const [tipo, alvo] = partir(item);
    return tipo === "worktree" && alvo.includes("/rodadas/") ? -1 : ordem.indexOf(tipo);
  };
  const ordenados = [...pendentes].sort((a, b) => posicao(a) - posicao(b));
  return naFilaDoProjeto(raiz, projeto.nome, async () => {
    const resultado = { removidos: [] as string[], pendentes: [] as string[] };
    for (const item of ordenados) {
      const feito = await executar(ambiente, projeto.raiz_git, ...partir(item)).catch(() => false);
      (feito ? resultado.removidos : resultado.pendentes).push(item);
    }
    return resultado;
  });
}

/** Confere no disco e no git que nada do que foi removido sobrou. */
export async function sobrasDaDemanda(
  ambiente: Ambiente,
  projeto: ProjetoLimpeza,
  removidos: readonly string[],
): Promise<string[]> {
  const sobras: string[] = [];
  for (const item of removidos) {
    const [tipo, alvo] = partir(item);
    const sobrou =
      tipo === "worktree"
        ? existsSync(alvo)
        : tipo === "branch_local"
          ? await refLocal(ambiente, projeto.raiz_git, alvo)
          : await refRemota(projeto.raiz_git, alvo);
    if (sobrou) sobras.push(item);
  }
  return sobras;
}

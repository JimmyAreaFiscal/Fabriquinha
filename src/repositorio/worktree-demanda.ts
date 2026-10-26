// Worktree de agregação da demanda (comparacao-sdlc-implementacao.md §2.3/4.1).
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { branchDemanda, branchRodada, DemandaId, RodadaRef } from "../dominio/demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { Slug } from "../dominio/primitivos.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { git } from "../processo.ts";
import { exigirGit, naFilaDoProjeto, preparar } from "./worktree.ts";

function recusar(motivo: string): never {
  throw new ErroDeRegra(
    motivo,
    "corrija os identificadores ou a ocupação da worktree; nenhum dado foi adotado ou removido",
  );
}

export function caminhoDaWorktreeDemanda(raiz: string, nome: string, demandaId: string): string {
  if (!Slug.safeParse(nome).success || !DemandaId.safeParse(demandaId).success) {
    recusar("projeto ou demanda inválidos");
  }
  return resolve(raiz, "worktrees", nome, demandaId, "demanda");
}

export function caminhoDaWorktreeRodada(
  raiz: string,
  nome: string,
  ref: { demanda_id: string; rodada_id: number },
): string {
  if (!RodadaRef.safeParse(ref).success) recusar("identidade da rodada inválida");
  return join(dirname(caminhoDaWorktreeDemanda(raiz, nome, ref.demanda_id)), "rodadas", String(ref.rodada_id));
}

const dentro = (pai: string, filho: string): boolean => filho.startsWith(`${pai}${sep}`);

/** Não seguir links, nem confundir um diretório dentro de um checkout com sua raiz. */
function verificarDisco(raiz: string, caminho: string): void {
  let atual = resolve(raiz);
  for (const parte of relative(atual, caminho).split(sep)) {
    atual = join(atual, parte);
    const stat = lstatSync(atual, { throwIfNoEntry: false });
    if (stat === undefined) break;
    if (stat.isSymbolicLink() || !stat.isDirectory()) recusar(`componente gerenciado indevido: ${atual}`);
  }
  for (let pai = dirname(caminho); ; pai = dirname(pai)) {
    if (lstatSync(join(pai, ".git"), { throwIfNoEntry: false }) !== undefined) {
      recusar(`worktree ancestral em ${pai}`);
    }
    if (pai === dirname(pai)) break;
  }
  function descendentes(pasta: string): void {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      if (entrada.name === ".git") continue;
      const filho = join(pasta, entrada.name);
      if (entrada.isDirectory()) {
        if (lstatSync(join(filho, ".git"), { throwIfNoEntry: false }) !== undefined) {
          recusar(`worktree descendente em ${filho}`);
        }
        descendentes(filho);
      }
    }
  }
  if (existsSync(caminho)) descendentes(caminho);
}

async function verificarWorktrees(repo: string, caminho: string, ref: string): Promise<void> {
  const lista = await exigirGit(repo, "worktree", "list", "--porcelain", "-z");
  for (const bloco of lista.split("\0\0")) {
    const campos = bloco.split("\0");
    const campo = campos.find((c) => c.startsWith("worktree "));
    if (campo === undefined) continue;
    const pasta = resolve(campo.slice("worktree ".length));
    if (dentro(pasta, caminho) || dentro(caminho, pasta)) recusar(`worktree aninhada em ${pasta}`);
    const branchEsperada = campos.includes(`branch ${ref}`);
    if (pasta === caminho && !branchEsperada) recusar(`checkout indevido registrado em ${pasta}`);
    if (pasta !== caminho && branchEsperada) recusar(`branch já usada em ${pasta}`);
  }
}

async function verificarCheckout(
  raiz: string,
  repo: string,
  caminho: string,
  branch: string,
  dono: string,
  obrigatorio = false,
): Promise<boolean> {
  const ref = `refs/heads/${branch}`;
  verificarDisco(raiz, caminho);
  await verificarWorktrees(repo, caminho, ref);
  const refs = await exigirGit(repo, "for-each-ref", "--format=%(refname)", ref);
  const existe = refs.split("\n").includes(ref);
  if (!existe && refs !== "") recusar(`outra branch ocupa o prefixo ${ref}`);
  const posse = (await exigirGit(repo, "config", "--default", "", "--get", `branch.${branch}.fabriquinha`)).replace(
    /\n$/,
    "",
  );
  if ((existe || posse !== "") && posse !== dono) recusar(`a branch ${branch} não pertence a esta demanda/rodada`);
  if (obrigatorio && (!existe || !existsSync(caminho))) recusar(`worktree obrigatória ausente em ${caminho}`);
  if (existsSync(caminho)) {
    if (!existe || lstatSync(join(caminho, ".git"), { throwIfNoEntry: false }) === undefined) {
      recusar(`destino ocupado em ${caminho}`);
    }
    const topo = (await exigirGit(caminho, "rev-parse", "--show-toplevel")).trim();
    const comum = (await exigirGit(caminho, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
    const esperado = (await exigirGit(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
    const atual = (await exigirGit(caminho, "symbolic-ref", "HEAD")).trim();
    if (
      realpathSync(topo) !== realpathSync(caminho) ||
      realpathSync(comum) !== realpathSync(esperado) ||
      atual !== ref
    ) {
      recusar(`checkout indevido em ${caminho}`);
    }
  }
  return existe;
}

/** Cria da base configurada; uma branch própria existente nunca é avançada implicitamente. */
export async function garantirWorktreeDemanda(
  raiz: string,
  projeto: Pick<Projeto, "nome" | "repo" | "branchBase" | "preparacao">,
  demandaId: string,
  log: string,
  varrerBase: () => Promise<void>,
): Promise<string> {
  const caminho = caminhoDaWorktreeDemanda(raiz, projeto.nome, demandaId);
  const branch = branchDemanda(demandaId);
  const chave = `branch.${branch}.fabriquinha`;
  const dono = `demanda:${caminho}`;
  const { buscouBase, marca } = await naFilaDoProjeto(raiz, projeto.nome, async () => {
    const existe = await verificarCheckout(raiz, projeto.repo, caminho, branch, dono);
    if (existsSync(caminho)) {
      // Checkout já validado; conservar o histórico.
    } else if (existe) {
      await exigirGit(projeto.repo, "worktree", "prune", "--expire", "now");
      await exigirGit(projeto.repo, "worktree", "add", caminho, branch);
    } else {
      await exigirGit(
        projeto.repo,
        "fetch",
        "origin",
        `+refs/heads/${projeto.branchBase}:refs/remotes/origin/${projeto.branchBase}`,
      );
      await exigirGit(projeto.repo, "config", chave, dono);
      await exigirGit(
        projeto.repo,
        "worktree",
        "add",
        "-b",
        branch,
        caminho,
        `refs/remotes/origin/${projeto.branchBase}`,
      );
    }
    const marca = (
      await exigirGit(caminho, "rev-parse", "--path-format=absolute", "--git-path", "fabriquinha-preparada")
    ).trim();
    return { buscouBase: !existe, marca };
  });
  if (buscouBase) {
    try {
      await varrerBase();
    } catch (erro) {
      anotar(log, `varrerBase falhou: ${String(erro)}`);
    }
  }
  if (!existsSync(marca)) {
    await preparar(caminho, projeto.preparacao, log);
    writeFileSync(marca, "");
  }
  return caminho;
}

type ProjetoWorktree = Pick<Projeto, "nome" | "repo" | "branchBase" | "preparacao">;
interface RefRodada {
  demanda_id: string;
  rodada_id: number;
}
export type ResultadoAtualizacao =
  { status: "atualizada" } | { status: "sem_alteracao" } | { status: "conflito"; arquivos: string[] };

// Falhas de disco também precisam orientar o operador, sem mascarar erros de regra/Git.
async function comOrientacao<T>(trabalho: () => Promise<T>): Promise<T> {
  try {
    return await trabalho();
  } catch (erro) {
    if (erro instanceof ErroDeRegra) throw erro;
    throw new ErroDeRegra(String(erro), "verifique permissões e metadados da worktree antes de tentar novamente");
  }
}

async function marcaPreparacao(caminho: string): Promise<string> {
  return (
    await exigirGit(caminho, "rev-parse", "--path-format=absolute", "--git-path", "fabriquinha-preparada")
  ).trim();
}

async function prepararRodada(caminho: string, projeto: ProjetoWorktree, log: string, marca: string): Promise<void> {
  await preparar(caminho, projeto.preparacao, log);
  writeFileSync(marca, "");
}

async function validarDemanda(raiz: string, projeto: ProjetoWorktree, ref: RefRodada): Promise<string> {
  const demanda = caminhoDaWorktreeDemanda(raiz, projeto.nome, ref.demanda_id);
  const branch = branchDemanda(ref.demanda_id);
  await verificarCheckout(raiz, projeto.repo, demanda, branch, `demanda:${demanda}`, true);
  return (await exigirGit(projeto.repo, "rev-parse", `refs/heads/${branch}`)).trim();
}

export async function garantirWorktreeRodada(
  raiz: string,
  projeto: ProjetoWorktree,
  ref: RefRodada,
  log: string,
): Promise<string> {
  const caminho = caminhoDaWorktreeRodada(raiz, projeto.nome, ref);
  const branch = branchRodada(ref.demanda_id, ref.rodada_id);
  return comOrientacao(async () => {
    const marca = await naFilaDoProjeto(raiz, projeto.nome, async () => {
      const sha = await validarDemanda(raiz, projeto, ref);
      const existe = await verificarCheckout(raiz, projeto.repo, caminho, branch, `rodada:${caminho}`);
      if (!existsSync(caminho)) {
        if (existe) {
          await exigirGit(projeto.repo, "worktree", "prune", "--expire", "now");
          await exigirGit(projeto.repo, "worktree", "add", caminho, branch);
        } else {
          await exigirGit(projeto.repo, "config", `branch.${branch}.fabriquinha`, `rodada:${caminho}`);
          await exigirGit(projeto.repo, "worktree", "add", "-b", branch, caminho, sha);
        }
      }
      return marcaPreparacao(caminho);
    });
    if (!existsSync(marca)) await prepararRodada(caminho, projeto, log, marca);
    return caminho;
  });
}

async function caminhoGit(caminho: string, nome: string): Promise<string> {
  return (await exigirGit(caminho, "rev-parse", "--path-format=absolute", "--git-path", nome)).trim();
}

async function verificarLimpa(caminho: string): Promise<void> {
  if (
    (await exigirGit(caminho, "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all")) !== ""
  ) {
    throw new ErroDeRegra(
      `worktree com alterações em ${caminho}`,
      "inspecione git status e preserve ou registre o trabalho antes de tentar novamente",
    );
  }
  for (const nome of [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_START",
    "sequencer",
  ]) {
    if (lstatSync(await caminhoGit(caminho, nome), { throwIfNoEntry: false }) !== undefined) {
      throw new ErroDeRegra(
        `operação pendente ${nome} em ${caminho}`,
        "inspecione a worktree e conclua ou aborte a operação manualmente",
      );
    }
  }
}

async function restaurarMerge(caminho: string, antes: string): Promise<void> {
  if (lstatSync(await caminhoGit(caminho, "MERGE_HEAD"), { throwIfNoEntry: false }) !== undefined) {
    await exigirGit(caminho, "merge", "--abort");
  }
  if ((await exigirGit(caminho, "rev-parse", "HEAD")).trim() !== antes) {
    throw new ErroDeRegra(
      "HEAD alterado após merge falho",
      "inspecione o histórico manualmente antes de tentar novamente",
    );
  }
  await verificarLimpa(caminho);
}

export async function atualizarWorktreeRodada(
  raiz: string,
  projeto: ProjetoWorktree,
  ref: RefRodada,
  log: string,
): Promise<ResultadoAtualizacao> {
  const caminho = caminhoDaWorktreeRodada(raiz, projeto.nome, ref);
  const branch = branchRodada(ref.demanda_id, ref.rodada_id);
  return comOrientacao(async () => {
    const resultado = await naFilaDoProjeto(raiz, projeto.nome, async (): Promise<ResultadoAtualizacao> => {
      const sha = await validarDemanda(raiz, projeto, ref);
      await verificarCheckout(raiz, projeto.repo, caminho, branch, `rodada:${caminho}`, true);
      await verificarLimpa(caminho);
      const antes = (await exigirGit(caminho, "rev-parse", "HEAD")).trim();
      const merge = await git(caminho, "merge", "--no-edit", sha);
      if (merge.codigo !== 0) {
        // Ler conflitos antes do abort; mesmo falhando a leitura, restaurar o merge iniciado aqui.
        let arquivos: string[];
        try {
          arquivos = (await exigirGit(caminho, "diff", "--name-only", "--diff-filter=U", "-z"))
            .split("\0")
            .filter(Boolean);
        } finally {
          await restaurarMerge(caminho, antes);
        }
        if (arquivos.length === 0) {
          throw new ErroDeRegra(
            `merge falhou: ${merge.saida}${merge.erro}`,
            "corrija a falha operacional do Git e tente novamente",
          );
        }
        return { status: "conflito", arquivos };
      }
      const mudouHead = (await exigirGit(caminho, "rev-parse", "HEAD")).trim() !== antes;
      if (mudouHead) rmSync(await marcaPreparacao(caminho), { force: true });
      await verificarLimpa(caminho);
      return { status: mudouHead ? "atualizada" : "sem_alteracao" };
    });
    if (resultado.status === "atualizada") await prepararRodada(caminho, projeto, log, await marcaPreparacao(caminho));
    return resultado;
  });
}

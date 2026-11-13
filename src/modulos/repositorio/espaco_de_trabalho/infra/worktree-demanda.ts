// Worktree de agregação da demanda (comparacao-sdlc-implementacao.md §2.3/4.1).
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { Slug } from "../../../../shared/nucleo/primitivos.ts";
import { type Ambiente, PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA } from "../../../ambiente/publico.ts";
import {
  exigirGit,
  exigirGitNoAmbiente,
  gitNoAmbiente,
  naFilaDoProjeto,
  type RepositorioDoProjeto,
} from "../../git/publico.ts";
import { podarWorktreesNoCore, preparar } from "./worktree.ts";
import { branchDemanda, branchRodada, DemandaId, RodadaDoEspaco } from "../nucleo/nome_do_espaco.ts";

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
  if (!RodadaDoEspaco.safeParse(ref).success) recusar("identidade da rodada inválida");
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

async function verificarWorktrees(ambiente: Ambiente, repo: string, caminho: string, ref: string): Promise<void> {
  const lista = await exigirGitNoAmbiente(ambiente, repo, "worktree", "list", "--porcelain", "-z");
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
  ambiente: Ambiente,
  raiz: string,
  repo: string,
  caminho: string,
  branch: string,
  dono: string,
  obrigatorio = false,
): Promise<boolean> {
  const ref = `refs/heads/${branch}`;
  verificarDisco(raiz, caminho);
  await verificarWorktrees(ambiente, repo, caminho, ref);
  const refs = await exigirGitNoAmbiente(ambiente, repo, "for-each-ref", "--format=%(refname)", ref);
  const existe = refs.split("\n").includes(ref);
  if (!existe && refs !== "") recusar(`outra branch ocupa o prefixo ${ref}`);
  // A posse mora na config do clone, que o container vê congelada (montagem de arquivo) e só em leitura.
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
    const topo = (await exigirGitNoAmbiente(ambiente, caminho, "rev-parse", "--show-toplevel")).trim();
    const comum = (
      await exigirGitNoAmbiente(ambiente, caminho, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ).trim();
    const esperado = (
      await exigirGitNoAmbiente(ambiente, repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ).trim();
    const atual = (await exigirGitNoAmbiente(ambiente, caminho, "symbolic-ref", "HEAD")).trim();
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

/**
 * `git worktree add`. No Ambiente que não escreve em todo o `.git` do clone o `.git/worktrees` é só leitura (o Ambiente
 * não toca nas worktrees do usuário), então o core cria a worktree, sem hooks, e move a pasta administrativa dela para a
 * pasta que o Ambiente escreve, deixando em `worktrees` um link para lá. O `commondir` relativo (`../..`) continua valendo, porque a pasta nova tem a mesma
 * profundidade.
 */
async function adicionarWorktree(
  ambiente: Ambiente,
  raiz_git: string,
  caminho: string,
  argumentosDoAdd: string[],
): Promise<void> {
  if (ambiente.escreveEmTodoOGitDoClone) {
    await exigirGitNoAmbiente(ambiente, raiz_git, "worktree", "add", ...argumentosDoAdd);
    return;
  }
  await exigirGit(raiz_git, "-c", "core.hooksPath=/dev/null", "worktree", "add", ...argumentosDoAdd);
  const entrada = readFileSync(join(caminho, ".git"), "utf8")
    .trim()
    .replace(/^gitdir: /, "");
  const entradaNaPastaDaFabriquinha = join(
    dirname(dirname(entrada)),
    PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA,
    basename(entrada),
  );
  mkdirSync(dirname(entradaNaPastaDaFabriquinha), { recursive: true });
  renameSync(entrada, entradaNaPastaDaFabriquinha);
  symlinkSync(relative(dirname(entrada), entradaNaPastaDaFabriquinha), entrada);
}

type ProjetoWorktree = Pick<RepositorioDoProjeto, "nome" | "raiz_git" | "branch_base" | "verificacoes">;

/**
 * Cria da base configurada; uma branch própria existente nunca é avançada implicitamente. Devolve a pasta e se buscou
 * a base no origin (só na criação da branch), para quem chama varrer os commits humanos depois, fora da fila.
 */
export async function garantirWorktreeDemandaDizendoSeBuscouBase(
  ambiente: Ambiente,
  raiz: string,
  projeto: ProjetoWorktree,
  demandaId: string,
  log: string,
): Promise<{ caminho: string; buscouBase: boolean }> {
  const caminho = caminhoDaWorktreeDemanda(raiz, projeto.nome, demandaId);
  const branch = branchDemanda(demandaId);
  const chave = `branch.${branch}.fabriquinha`;
  const dono = `demanda:${caminho}`;
  const { buscouBase, marca } = await naFilaDoProjeto(raiz, projeto.nome, async () => {
    const existe = await verificarCheckout(ambiente, raiz, projeto.raiz_git, caminho, branch, dono);
    if (existsSync(caminho)) {
      // Checkout já validado; conservar o histórico.
    } else if (existe) {
      await podarWorktreesNoCore(projeto.raiz_git);
      await adicionarWorktree(ambiente, projeto.raiz_git, caminho, [caminho, branch]);
    } else {
      await exigirGit(
        projeto.raiz_git,
        "fetch",
        "origin",
        `+refs/heads/${projeto.branch_base}:refs/remotes/origin/${projeto.branch_base}`,
      );
      // A config do clone é só leitura no container: a posse da branch é gravada pelo core.
      await exigirGit(projeto.raiz_git, "config", chave, dono);
      await adicionarWorktree(ambiente, projeto.raiz_git, caminho, [
        "--no-track",
        "-b",
        branch,
        caminho,
        `refs/remotes/origin/${projeto.branch_base}`,
      ]);
    }
    const marca = (
      await exigirGitNoAmbiente(
        ambiente,
        caminho,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "fabriquinha-preparada",
      )
    ).trim();
    return { buscouBase: !existe, marca };
  });
  if (!existsSync(marca)) {
    await preparar(ambiente, caminho, projeto.verificacoes.preparacao, log);
    writeFileSync(marca, "");
  }
  return { caminho, buscouBase };
}

/** Só a pasta da worktree da demanda; quem precisa saber se buscou a base usa a variante que o diz. */
export async function garantirWorktreeDemanda(
  ambiente: Ambiente,
  raiz: string,
  projeto: ProjetoWorktree,
  demandaId: string,
  log: string,
): Promise<string> {
  return (await garantirWorktreeDemandaDizendoSeBuscouBase(ambiente, raiz, projeto, demandaId, log)).caminho;
}

interface RefRodada {
  demanda_id: string;
  rodada_id: number;
}
export type ResultadoAtualizacao =
  { status: "atualizada" } | { status: "sem_alteracao" } | { status: "conflito"; arquivos: string[] };

// Falhas de disco também precisam orientar o operador, sem mascarar erros de regra/Git.
async function throwErroComOrientacao<T>(funcaoComComandoGit: () => Promise<T>): Promise<T> {
  try {
    return await funcaoComComandoGit();
  } catch (erro) {
    if (erro instanceof ErroDeRegra) throw erro;
    throw new ErroDeRegra(String(erro), "verifique permissões e metadados da worktree antes de tentar novamente");
  }
}

async function marcaPreparacao(ambiente: Ambiente, caminho: string): Promise<string> {
  return (
    await exigirGitNoAmbiente(
      ambiente,
      caminho,
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "fabriquinha-preparada",
    )
  ).trim();
}

async function prepararRodada(
  ambiente: Ambiente,
  caminho: string,
  projeto: ProjetoWorktree,
  log: string,
  marca: string,
): Promise<void> {
  await preparar(ambiente, caminho, projeto.verificacoes.preparacao, log);
  writeFileSync(marca, "");
}

async function validarDemanda(
  ambiente: Ambiente,
  raiz: string,
  projeto: ProjetoWorktree,
  ref: RefRodada,
): Promise<string> {
  const demanda = caminhoDaWorktreeDemanda(raiz, projeto.nome, ref.demanda_id);
  const branch = branchDemanda(ref.demanda_id);
  await verificarCheckout(ambiente, raiz, projeto.raiz_git, demanda, branch, `demanda:${demanda}`, true);
  return (await exigirGitNoAmbiente(ambiente, projeto.raiz_git, "rev-parse", `refs/heads/${branch}`)).trim();
}

export async function garantirWorktreeRodada(
  ambiente: Ambiente,
  raiz: string,
  projeto: ProjetoWorktree,
  ref: RefRodada,
  log: string,
): Promise<string> {
  const caminho = caminhoDaWorktreeRodada(raiz, projeto.nome, ref);
  const branch = branchRodada(ref.demanda_id, ref.rodada_id);
  return throwErroComOrientacao(async () => {
    const marca = await naFilaDoProjeto(raiz, projeto.nome, async () => {
      const sha = await validarDemanda(ambiente, raiz, projeto, ref);
      const existe = await verificarCheckout(ambiente, raiz, projeto.raiz_git, caminho, branch, `rodada:${caminho}`);
      if (!existsSync(caminho)) {
        if (existe) {
          await podarWorktreesNoCore(projeto.raiz_git);
          await adicionarWorktree(ambiente, projeto.raiz_git, caminho, [caminho, branch]);
        } else {
          await exigirGit(projeto.raiz_git, "config", `branch.${branch}.fabriquinha`, `rodada:${caminho}`);
          await adicionarWorktree(ambiente, projeto.raiz_git, caminho, ["--no-track", "-b", branch, caminho, sha]);
        }
      }
      return marcaPreparacao(ambiente, caminho);
    });
    if (!existsSync(marca)) await prepararRodada(ambiente, caminho, projeto, log, marca);
    return caminho;
  });
}

async function caminhoGit(ambiente: Ambiente, caminho: string, nome: string): Promise<string> {
  return (
    await exigirGitNoAmbiente(ambiente, caminho, "rev-parse", "--path-format=absolute", "--git-path", nome)
  ).trim();
}

async function verificarLimpa(ambiente: Ambiente, caminho: string): Promise<void> {
  if (
    (await exigirGitNoAmbiente(
      ambiente,
      caminho,
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    )) !== ""
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
    if (lstatSync(await caminhoGit(ambiente, caminho, nome), { throwIfNoEntry: false }) !== undefined) {
      throw new ErroDeRegra(
        `operação pendente ${nome} em ${caminho}`,
        "inspecione a worktree e conclua ou aborte a operação manualmente",
      );
    }
  }
}

async function restaurarMerge(ambiente: Ambiente, caminho: string, antes: string): Promise<void> {
  if (lstatSync(await caminhoGit(ambiente, caminho, "MERGE_HEAD"), { throwIfNoEntry: false }) !== undefined) {
    await exigirGitNoAmbiente(ambiente, caminho, "merge", "--abort");
  }
  if ((await exigirGitNoAmbiente(ambiente, caminho, "rev-parse", "HEAD")).trim() !== antes) {
    throw new ErroDeRegra(
      "HEAD alterado após merge falho",
      "inspecione o histórico manualmente antes de tentar novamente",
    );
  }
  await verificarLimpa(ambiente, caminho);
}

export async function atualizarWorktreeRodada(
  ambiente: Ambiente,
  raiz: string,
  projeto: ProjetoWorktree,
  ref: RefRodada,
  log: string,
): Promise<ResultadoAtualizacao> {
  const caminho = caminhoDaWorktreeRodada(raiz, projeto.nome, ref);
  const branch = branchRodada(ref.demanda_id, ref.rodada_id);
  return throwErroComOrientacao(async () => {
    const resultado = await naFilaDoProjeto(raiz, projeto.nome, async (): Promise<ResultadoAtualizacao> => {
      const sha = await validarDemanda(ambiente, raiz, projeto, ref);
      await verificarCheckout(ambiente, raiz, projeto.raiz_git, caminho, branch, `rodada:${caminho}`, true);
      await verificarLimpa(ambiente, caminho);
      const antes = (await exigirGitNoAmbiente(ambiente, caminho, "rev-parse", "HEAD")).trim();
      const merge = await gitNoAmbiente(ambiente, caminho, "merge", "--no-edit", sha);
      if (merge.codigo !== 0) {
        // Ler conflitos antes do abort; mesmo falhando a leitura, restaurar o merge iniciado aqui.
        let arquivos: string[];
        try {
          arquivos = (await exigirGitNoAmbiente(ambiente, caminho, "diff", "--name-only", "--diff-filter=U", "-z"))
            .split("\0")
            .filter(Boolean);
        } finally {
          await restaurarMerge(ambiente, caminho, antes);
        }
        if (arquivos.length === 0) {
          throw new ErroDeRegra(
            `merge falhou: ${merge.saida}${merge.erro}`,
            "corrija a falha operacional do Git e tente novamente",
          );
        }
        return { status: "conflito", arquivos };
      }
      const mudouHead = (await exigirGitNoAmbiente(ambiente, caminho, "rev-parse", "HEAD")).trim() !== antes;
      if (mudouHead) rmSync(await marcaPreparacao(ambiente, caminho), { force: true });
      await verificarLimpa(ambiente, caminho);
      return { status: mudouHead ? "atualizada" : "sem_alteracao" };
    });
    if (resultado.status === "atualizada") {
      await prepararRodada(ambiente, caminho, projeto, log, await marcaPreparacao(ambiente, caminho));
    }
    return resultado;
  });
}

// Conferência do projeto antes de C19 (F5 §2): para no primeiro problema, com a mensagem do que fazer.
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Hospedagem, Projeto } from "../dominio/projeto.ts";
import { executar } from "../processo.ts";

// F5 §2.1. O `usuario@` opcional nas URLs HTTPS do Azure é o formato que o próprio botão Clone do Azure DevOps dá.
const REMOTOS: [RegExp, Hospedagem][] = [
  [/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/, "github"],
  [/^git@github\.com:[^/\s]+\/[^/\s]+$/, "github"],
  [/^https:\/\/([^/@\s]+@)?dev\.azure\.com\/[^/\s]+\/[^/\s]+\/_git\/[^/\s]+$/, "azure-devops"],
  [/^https:\/\/([^/@\s]+@)?[^/.@\s]+\.visualstudio\.com\/[^/\s]+\/_git\/[^/\s]+$/, "azure-devops"],
  [/^git@ssh\.dev\.azure\.com:v3\/[^/\s]+\/[^/\s]+\/[^/\s]+$/, "azure-devops"],
  [/^[^/@\s]+@vs-ssh\.visualstudio\.com:v3\/[^/\s]+\/[^/\s]+\/[^/\s]+$/, "azure-devops"],
];

/** Hospedagem pelos formatos de URL do `origin` aceitos (F5 §2.1); qualquer outro host dá `undefined`. */
export const hospedagemDoRemoto = (url: string): Hospedagem | undefined =>
  REMOTOS.find(([padrao]) => padrao.test(url))?.[1];

// Sem terminal para pedir senha: git falha em vez de esperar quem não está ali.
const git = (repo: string, ...args: string[]) =>
  executar("git", ["-C", repo, ...args], { ...process.env, GIT_TERMINAL_PROMPT: "0" });

/** F5 §2: confere repositório, identidade, remoto, branch base e CLI da hospedagem, nessa ordem. */
export async function conferirProjeto({
  repo,
  branchBase,
}: Pick<Projeto, "repo" | "branchBase">): Promise<{ hospedagem: Hospedagem }> {
  const topo = await git(repo, "rev-parse", "--show-toplevel");
  if (topo.codigo !== 0) {
    throw new ErroDeRegra(`${repo} não é um repositório git`, "informe o caminho da raiz de um clone do projeto");
  }
  // Literal, como o F5 pede: "/x/repo/" ou um symlink não viram um segundo projeto para o mesmo repositório.
  const raiz = topo.saida.trim();
  if (raiz !== repo) {
    throw new ErroDeRegra(`${repo} não é a raiz do repositório git`, `informe a raiz, ${raiz}`);
  }

  for (const chave of ["user.name", "user.email"]) {
    if ((await git(repo, "config", chave)).saida.trim() === "") {
      throw new ErroDeRegra(
        `o repositório ${repo} não tem ${chave} para os commits`,
        `configure com git -C ${repo} config ${chave} <valor>`,
      );
    }
  }

  const url = (await git(repo, "config", "--get", "remote.origin.url")).saida.trim();
  if (url === "") {
    throw new ErroDeRegra(`o repositório ${repo} não tem o remoto origin`, "adicione com git remote add origin <url>");
  }
  const hospedagem = hospedagemDoRemoto(url);
  if (!hospedagem) {
    throw new ErroDeRegra(
      `o remoto origin (${url}) não é GitHub nem Azure DevOps`,
      "a Fabriquinha só abre PR em github.com e dev.azure.com; aponte o origin para um deles",
    );
  }

  // O padrão começa com refs/heads/: um branchBase como "--upload-pack=…" nunca vira opção do git.
  const ref = `refs/heads/${branchBase}`;
  const remoto = await git(repo, "ls-remote", "--heads", "origin", ref);
  if (remoto.codigo !== 0) {
    throw new ErroDeRegra(
      `não foi possível ler o origin de ${repo}: ${remoto.erro.trim()}`,
      "confira o acesso ao remoto com git ls-remote origin",
    );
  }
  // ls-remote casa pelo fim do nome (main casaria feature/main): confere a ref exata.
  if (!remoto.saida.split("\n").some((linha) => linha.endsWith(`\t${ref}`))) {
    throw new ErroDeRegra(`a branch ${branchBase} não existe no origin`, "informe uma branch base já publicada");
  }

  await conferirCli(hospedagem);
  return { hospedagem };
}

/** Conferência 5: o CLI da hospedagem está autenticado (e, no Azure DevOps, com a extensão). */
async function conferirCli(hospedagem: Hospedagem): Promise<void> {
  if (hospedagem === "github") {
    if ((await executar("gh", ["auth", "status", "--hostname", "github.com"])).codigo !== 0) {
      throw new ErroDeRegra("o gh não está autenticado", "rode gh auth login");
    }
  } else {
    if ((await executar("az", ["account", "show"])).codigo !== 0) {
      throw new ErroDeRegra("o az não está autenticado", "rode az login");
    }
    if ((await executar("az", ["extension", "show", "--name", "azure-devops"])).codigo !== 0) {
      throw new ErroDeRegra("falta a extensão azure-devops do az", "rode az extension add --name azure-devops");
    }
  }
}

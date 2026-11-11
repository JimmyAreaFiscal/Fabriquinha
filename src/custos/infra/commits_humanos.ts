// Git dos commits humanos posteriores (F6 §4): busca da base, log dos commits novos e blame das linhas reescritas.
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { LIMITE_COMANDO_MS } from "../../ambiente/infra/ambiente.ts";
import { executar, git } from "../../compartilhado/infra/processo.ts";
import { exigirGit } from "../../ambiente/infra/worktree/worktree.ts";

/** Cabeçalho de hunk do `-U0`: `@@ -início[,quantidade] ...`, sem quantidade quando é uma linha só. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? /gm;
/** Cabeçalho de cada linha no blame porcelain: `<sha> <linha antes> <linha depois>`; o conteúdo vem após um tab. */
const LINHA_BLAME = /^([\da-f]{40}(?:[\da-f]{24})?) \d+ \d+/gm;
/** Modo do lado antigo no `--raw`: o arquivo não existia, ou é um submódulo, que não tem linhas. */
const SEM_LINHAS = new Set(["000000", "160000"]);

/** Um commit novo da base: o sha, o primeiro pai (vazio no commit raiz) e o autor. */
interface CommitNovoDaBase {
  sha: string;
  primeiroPai: string;
  autor: string;
}

/**
 * `git blame` sem a configuração global: ele não precisa dela, e um `blame.ignoreRevsFile` global que aponta para um
 * arquivo que o repositório não tem o faz falhar (`could not open object name list`), sem que `-c` ou
 * `--ignore-revs-file=` o desliguem.
 * ponytail: o mesmo `blame.ignoreRevsFile` na configuração do próprio repositório, sem o arquivo, ainda falha.
 */
async function blame(repo: string, args: string[]): Promise<string> {
  const r = await executar("git", ["-C", repo, "blame", ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    limiteMs: LIMITE_COMANDO_MS,
  });
  if (r.codigo !== 0) {
    throw new ErroDeRegra(
      `git blame falhou em ${repo}: ${r.erro.trim()}`,
      "corrija o repositório; o relatório refaz a conta",
    );
  }
  return r.saida;
}

/**
 * F6 §4.2, passos 1 a 3: quantas linhas de cada commit de origem o commit `sha` removeu ou reescreveu em relação a
 * `pai`. O `--raw -z` lista os arquivos com os caminhos crus; o diff `-U0` de cada um dá os intervalos removidos, e o
 * blame do caminho antigo em `pai`, o commit de origem de cada linha. Arquivo binário não tem hunk e fica de fora.
 * ponytail: mudança só de espaço conta; com formatador inflando o número, passar `-w` no diff e no blame.
 */
export async function linhasReescritasPorCommitDeOrigem(
  repo: string,
  pai: string,
  sha: string,
): Promise<Map<string, number>> {
  const porCommit = new Map<string, number>();
  const raw = (await exigirGit(repo, "diff", "--raw", "-z", "-M", pai, sha)).split("\0");
  for (let i = 0; raw[i];) {
    // `:<modo antes> <modo depois> <objeto> <objeto> <status>`, e um caminho, ou dois na renomeação.
    const [modoAntes, , , , status] = String(raw[i]).slice(1).split(" ");
    const caminhos = raw.slice(i + 1, i + (status?.startsWith("R") ? 3 : 2));
    i += 1 + caminhos.length;
    if (SEM_LINHAS.has(String(modoAntes))) continue;
    // Sem textconv nem diff externo do repositório: as linhas são as do arquivo versionado.
    const diff = await exigirGit(
      repo,
      "--literal-pathspecs",
      "diff",
      "-U0",
      "-M",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      pai,
      sha,
      "--",
      ...caminhos,
    );
    const intervalos = [...diff.matchAll(HUNK)]
      .filter(([, , quantidade]) => quantidade !== "0")
      .flatMap(([, inicio, quantidade = "1"]) => ["-L", `${String(inicio)},+${quantidade}`]);
    if (intervalos.length === 0) continue;
    const origens = await blame(repo, ["--porcelain", ...intervalos, pai, "--", String(caminhos[0])]);
    for (const [, origem] of origens.matchAll(LINHA_BLAME)) {
      porCommit.set(String(origem), (porCommit.get(String(origem)) ?? 0) + 1);
    }
  }
  return porCommit;
}

/**
 * Busca a base do `origin` e devolve o sha dela. Refspec explícita, como na criação de worktree: um `branchBase`
 * começando com "-" nunca vira opção do git.
 */
export async function buscarBaseRemota(repo: string, branchBase: string): Promise<string> {
  const ref = `refs/remotes/origin/${branchBase}`;
  await exigirGit(repo, "fetch", "origin", `+refs/heads/${branchBase}:${ref}`);
  return (await exigirGit(repo, "rev-parse", "--verify", `${ref}^{commit}`)).trim();
}

/** A história foi reescrita (force-push) se o `cursor` deixou de ser ancestral do `atual`. */
export async function cursorSaiuDaHistoria(repo: string, cursor: string, atual: string): Promise<boolean> {
  return (await git(repo, "merge-base", "--is-ancestor", cursor, atual)).codigo !== 0;
}

/** Os commits de `cursor` (exclusive) até `atual`, sem merges, do mais antigo ao mais novo. */
export async function commitsNovosDaBase(repo: string, cursor: string, atual: string): Promise<CommitNovoDaBase[]> {
  // `%H`, os pais e o autor, um commit por registro; sem a assinatura que `log.showSignature` poria no meio.
  const log = await exigirGit(
    repo,
    "log",
    "--no-merges",
    "--reverse",
    "--no-show-signature",
    "-z",
    "--format=%H%n%P%n%an <%ae>",
    `${cursor}..${atual}`,
  );
  return log
    .split("\0")
    .filter(Boolean)
    .map((registro) => {
      const [sha = "", pais = "", autor = ""] = registro.split("\n");
      return { sha, primeiroPai: String(pais.split(" ")[0]), autor };
    });
}

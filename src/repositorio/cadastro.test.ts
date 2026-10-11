import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { conferirProjeto, hospedagemDoRemoto } from "./cadastro.ts";

// realpath: a conferência 1 compara caminhos literais, e o tmpdir pode ser um symlink (ex.: /tmp no macOS).
const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-cadastro-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// git sem a configuração do usuário da máquina: a identidade só existe onde o teste a põe.
const globalVazio = join(base, "gitconfig");
writeFileSync(globalVazio, "");
process.env.GIT_CONFIG_GLOBAL = globalVazio;
process.env.GIT_CONFIG_NOSYSTEM = "1";

// gh e az falsos na frente do PATH (F5 §9): anotam a chamada e saem com o código das variáveis FALSO_*.
const bin = join(base, "bin");
const log = join(base, "chamadas.log");
mkdirSync(bin);
const falso = (nome: string, corpo: string) => {
  writeFileSync(join(bin, nome), `#!/bin/sh\necho "${nome} $*" >> "${log}"\n${corpo}\n`);
  chmodSync(join(bin, nome), 0o755);
};
falso("gh", 'exit "${FALSO_GH:-0}"');
falso(
  "az",
  'case "$1" in account) exit "${FALSO_AZ_CONTA:-0}" ;; extension) exit "${FALSO_AZ_EXTENSAO:-0}" ;; esac\nexit 99',
);
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
const chamadas = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
beforeEach(() => {
  rmSync(log, { force: true });
  for (const v of ["FALSO_GH", "FALSO_AZ_CONTA", "FALSO_AZ_EXTENSAO"]) Reflect.deleteProperty(process.env, v);
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

/**
 * Clone real com `origin` apontando para `url`; um `insteadOf` local desvia o acesso para um repositório bare
 * no disco, com as branches `publicadas`. Assim o remoto tem cara de GitHub/Azure e o ls-remote é de verdade.
 */
function clone(url = "https://github.com/dono/repo.git", publicadas = ["main"], identidade = true): string {
  const bare = mkdtempSync(join(base, "origin-"));
  git(bare, "init", "--bare", "-q");
  const repo = mkdtempSync(join(base, "repo-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-q", "--allow-empty", "-m", "início");
  for (const branch of publicadas) git(repo, "push", "-q", bare, `HEAD:refs/heads/${branch}`);
  if (url) {
    git(repo, "remote", "add", "origin", url);
    git(repo, "config", `url.${bare}.insteadOf`, url);
  }
  if (identidade) {
    git(repo, "config", "user.name", "Auditor");
    git(repo, "config", "user.email", "auditor@exemplo.com");
  }
  return repo;
}

const recusa = async (dados: { repo: string; branchBase?: string }, mensagem: string) => {
  await assert.rejects(
    conferirProjeto({ branchBase: "main", ...dados }),
    (erro) => erro instanceof ErroDeRegra && erro.message === mensagem,
  );
};

test("hospedagemDoRemoto aceita só os formatos do F5 §2.1", () => {
  const casos: [string, string | undefined][] = [
    ["https://github.com/dono/repo", "github"],
    ["https://github.com/dono/repo.git", "github"],
    ["git@github.com:dono/repo.git", "github"],
    ["git@github.com:dono/repo", "github"],
    ["https://dev.azure.com/org/projeto/_git/repo", "azure-devops"],
    ["https://org@dev.azure.com/org/projeto/_git/repo", "azure-devops"],
    ["https://org.visualstudio.com/projeto/_git/repo", "azure-devops"],
    ["https://org@org.visualstudio.com/projeto/_git/repo", "azure-devops"],
    ["git@ssh.dev.azure.com:v3/org/projeto/repo", "azure-devops"],
    ["org@vs-ssh.visualstudio.com:v3/org/projeto/repo", "azure-devops"],
    ["https://github.empresa.com/dono/repo.git", undefined],
    ["https://gitlab.com/dono/repo.git", undefined],
    ["git@bitbucket.org:dono/repo.git", undefined],
    ["http://github.com/dono/repo", undefined],
    ["https://github.com/dono", undefined],
    ["https://github.com/dono/repo/extra", undefined],
    ["https://dev.azure.com/org/projeto/repo", undefined],
    ["/srv/git/repo.git", undefined],
  ];
  for (const [url, esperado] of casos) assert.equal(hospedagemDoRemoto(url), esperado, url);
});

test("projeto no GitHub com tudo certo devolve a hospedagem e confere o gh", async () => {
  assert.deepEqual(await conferirProjeto({ repo: clone(), branchBase: "main" }), { hospedagem: "github" });
  assert.deepEqual(chamadas(), ["gh auth status --hostname github.com"]);
});

test("projeto no Azure DevOps confere a conta e a extensão do az", async () => {
  const repo = clone("git@ssh.dev.azure.com:v3/org/projeto/repo", ["main", "develop"]);
  assert.deepEqual(await conferirProjeto({ repo, branchBase: "develop" }), { hospedagem: "azure-devops" });
  assert.deepEqual(chamadas(), ["az account show", "az extension show --name azure-devops"]);
});

test("1: recusa caminho que não é literalmente a raiz: barra no fim, symlink, subpasta", async () => {
  const repo = clone();
  const atalho = join(base, "atalho");
  symlinkSync(repo, atalho);
  mkdirSync(join(repo, "sub"));
  for (const caminho of [`${repo}/`, atalho, join(repo, "sub")]) {
    await recusa({ repo: caminho }, `${caminho} não é a raiz do repositório git (informe a raiz, ${repo})`);
  }
  assert.deepEqual(chamadas(), []);
});

test("1: recusa caminho que não é repositório git", async () => {
  const pasta = mkdtempSync(join(base, "solta-"));
  await recusa({ repo: pasta }, `${pasta} não é um repositório git (informe o caminho da raiz de um clone do projeto)`);
  await recusa(
    { repo: join(pasta, "nao-existe") },
    `${join(pasta, "nao-existe")} não é um repositório git (informe o caminho da raiz de um clone do projeto)`,
  );
  const repo = clone();
  mkdirSync(join(repo, "sub"));
  await recusa(
    { repo: join(repo, "sub") },
    `${join(repo, "sub")} não é a raiz do repositório git (informe a raiz, ${repo})`,
  );
});

test("2: recusa repositório sem user.name ou sem user.email, e para antes das conferências seguintes", async () => {
  const repo = clone("https://gitlab.com/dono/repo.git", ["main"], false);
  await recusa(
    { repo },
    `o repositório ${repo} não tem user.name para os commits (configure com git -C ${repo} config user.name <valor>)`,
  );
  git(repo, "config", "user.name", "Auditor");
  await recusa(
    { repo },
    `o repositório ${repo} não tem user.email para os commits (configure com git -C ${repo} config user.email <valor>)`,
  );
  assert.deepEqual(chamadas(), []);
});

test("3: recusa repositório sem origin ou com origin fora do GitHub e do Azure DevOps", async () => {
  const semOrigin = clone("");
  await recusa(
    { repo: semOrigin },
    `o repositório ${semOrigin} não tem o remoto origin (adicione com git remote add origin <url>)`,
  );
  await recusa(
    { repo: clone("https://gitlab.com/dono/repo.git") },
    "o remoto origin (https://gitlab.com/dono/repo.git) não é GitHub nem Azure DevOps (a Fabriquinha só abre PR em github.com e dev.azure.com; aponte o origin para um deles)",
  );
});

test("4: recusa branch base que não existe no origin, mesmo que outra termine com o mesmo nome", async () => {
  const repo = clone("https://github.com/dono/repo.git", ["feature/main"]);
  await recusa({ repo }, "a branch main não existe no origin (informe uma branch base já publicada)");
  assert.deepEqual(chamadas(), []);
});

test("4: branchBase com cara de opção não vira opção do git", async () => {
  const repo = clone();
  const marca = join(base, "injetado");
  await recusa(
    { repo, branchBase: `--upload-pack=touch ${marca}` },
    `a branch --upload-pack=touch ${marca} não existe no origin (informe uma branch base já publicada)`,
  );
  assert.equal(existsSync(marca), false);
});

test("4: recusa quando o origin não pode ser lido, com a saída do git", async () => {
  const repo = clone();
  const [chave = ""] = git(repo, "config", "--get-regexp", String.raw`^url\..*\.insteadof$`).split(" ");
  rmSync(chave.slice("url.".length, -".insteadof".length), { recursive: true }); // some o bare do origin
  await assert.rejects(
    conferirProjeto({ repo, branchBase: "main" }),
    (erro) =>
      erro instanceof ErroDeRegra &&
      erro.message.startsWith(`não foi possível ler o origin de ${repo}: fatal:`) &&
      erro.message.endsWith("(confira o acesso ao remoto com git ls-remote origin)"),
  );
});

test("5: recusa gh sem autenticação", async () => {
  process.env.FALSO_GH = "1";
  await recusa({ repo: clone() }, "o gh não está autenticado (rode gh auth login)");
});

test("5: recusa az sem login e az sem a extensão azure-devops", async () => {
  const repo = clone("https://dev.azure.com/org/projeto/_git/repo");
  process.env.FALSO_AZ_CONTA = "1";
  await recusa({ repo }, "o az não está autenticado (rode az login)");
  assert.deepEqual(chamadas(), ["az account show"]);
  process.env.FALSO_AZ_CONTA = "0";
  process.env.FALSO_AZ_EXTENSAO = "1";
  await recusa({ repo }, "falta a extensão azure-devops do az (rode az extension add --name azure-devops)");
});

// Git dos commits humanos posteriores (F6 §4.2) contra git real: que commits de origem as linhas reescritas tinham.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { linhasReescritasPorCommitDeOrigem } from "./commits_humanos.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-commits-humanos-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// git sem a configuração do usuário da máquina.
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const linhas = (...l: string[]) => `${l.join("\n")}\n`;

let n = 0;
/** Um repositório vazio na `main`, com `commitar` (escreve, ou remove com `null`, e commita tudo) e as linhas do commit. */
function repositorio() {
  const repo = join(base, `r${String(++n)}`);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  return {
    repo,
    commitar(arquivos: Record<string, string | Buffer | null>): string {
      for (const [caminho, conteudo] of Object.entries(arquivos)) {
        if (conteudo === null) git(repo, "rm", "-q", caminho);
        else writeFileSync(join(repo, caminho), conteudo);
      }
      git(repo, "add", "-A");
      git(repo, "commit", "-qm", "c");
      return git(repo, "rev-parse", "HEAD");
    },
    reescritas: (sha: string) => linhasReescritasPorCommitDeOrigem(repo, `${sha}^`, sha),
  };
}

test("arquivo removido conta todas as linhas", async () => {
  const r = repositorio();
  const a = r.commitar({ "a.txt": linhas("a1", "a2", "a3", "a4") });
  const b = r.commitar({ "a.txt": null });
  assert.deepEqual(await r.reescritas(b), new Map([[a, 4]]));
});

test("arquivo renomeado usa o caminho antigo e conta só as linhas reescritas", async () => {
  const r = repositorio();
  const a = r.commitar({ "a.txt": linhas("a1", "a2", "a3", "a4", "a5") });
  git(r.repo, "mv", "a.txt", "nome novo.txt");
  const b = r.commitar({ "nome novo.txt": linhas("a1", "B2", "a3", "a4", "a5") });
  assert.match(git(r.repo, "show", "-M", "--name-status", "--format=", b), /^R\d+/, "o git vê a renomeação");
  assert.deepEqual(await r.reescritas(b), new Map([[a, 1]]));
});

test("blame.ignoreRevsFile da configuração global, sem o arquivo no repositório, não derruba o blame", async (t) => {
  const home = mkdtempSync(join(base, "home-"));
  writeFileSync(
    join(home, ".gitconfig"),
    "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n[blame]\n\tignoreRevsFile = .git-blame-ignore-revs\n",
  );
  const { HOME, GIT_CONFIG_GLOBAL } = process.env;
  t.after(() => {
    Object.assign(process.env, { HOME, GIT_CONFIG_GLOBAL });
  });
  process.env.HOME = home;
  delete process.env.GIT_CONFIG_GLOBAL;

  const r = repositorio();
  const a = r.commitar({ "a.txt": linhas("a1", "a2") });
  const b = r.commitar({ "a.txt": linhas("B1", "a2") });
  assert.throws(() => git(r.repo, "blame", "HEAD~1", "--", "a.txt"), /could not open object name list/);
  assert.deepEqual(await r.reescritas(b), new Map([[a, 1]]));
  // Na configuração do próprio repositório, o blame ainda falha, e o erro diz por quê.
  git(r.repo, "config", "blame.ignoreRevsFile", ".git-blame-ignore-revs");
  await assert.rejects(r.reescritas(b), /git blame falhou em .*could not open object name list/);
});

test("caminho com caractere de glob é literal", async () => {
  const r = repositorio();
  const a = r.commitar({ "a.txt": linhas("a1", "a2", "a3", "a4"), "[a].txt": "x\n" });
  const b = r.commitar({ "a.txt": linhas("a1", "a2", "a3", "B4"), "[a].txt": "y\n" });
  assert.deepEqual(await r.reescritas(b), new Map([[a, 2]]));
});

test("arquivo binário e submódulo são ignorados", async () => {
  const r = repositorio();
  const sub = join(base, `sub${String(n)}`);
  mkdirSync(sub);
  git(sub, "init", "-q");
  git(sub, "commit", "-q", "--allow-empty", "-m", "um");
  const um = git(sub, "rev-parse", "HEAD");
  git(sub, "commit", "-q", "--allow-empty", "-m", "dois");
  const dois = git(sub, "rev-parse", "HEAD");
  // Submódulo não populado: a pasta vazia, e o gitlink só no índice.
  mkdirSync(join(r.repo, "sub"));
  git(r.repo, "update-index", "--add", "--cacheinfo", `160000,${um},sub`);
  // Um textconv do repositório mostraria o binário como texto: as linhas são as do arquivo versionado.
  git(r.repo, "config", "diff.texto.textconv", "cat");
  r.commitar({ ".gitattributes": "*.bin diff=texto\n", "a.bin": Buffer.from([0, 1, 2, 10, 3, 10]) });
  git(r.repo, "update-index", "--cacheinfo", `160000,${dois},sub`);
  const b = r.commitar({ "a.bin": Buffer.from([0, 9, 9, 10, 3, 10]) });
  assert.deepEqual(await r.reescritas(b), new Map());
});

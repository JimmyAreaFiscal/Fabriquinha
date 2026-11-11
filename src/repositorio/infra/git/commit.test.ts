import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../apoio-testes/docker_falso.ts";
import { ErroDeRegra, ErroDeReprovacao, ErroExterno } from "../../../compartilhado/nucleo/erros.ts";
import { AmbienteHostLocal } from "../../../sandbox/infra/host_local/ambiente_host_local.ts";
import { AmbienteContainer } from "../../../sandbox/infra/container/ambiente_container.ts";
import { arquivosDe, commitar } from "./commit.ts";

const ambiente = new AmbienteHostLocal();

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-commit-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// git sem a configuração do usuário da máquina, e com a detecção de renomeação desligada: o -M explícito vale.
writeFileSync(
  join(base, "gitconfig"),
  "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n[diff]\n\trenames = false\n",
);
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GH_TOKEN = "segredo-gh";
process.env.SONAR_TOKEN = "segredo-sonar";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

const LIMITE_MS = 60_000;

let n = 0;
/** Uma worktree com um commit inicial e os `hooks` dados (nome → corpo). */
function cenario(hooks: Record<string, string> = {}) {
  const worktree = join(base, `worktree${String(++n)}`);
  mkdirSync(worktree, { recursive: true });
  git(worktree, "init", "-q");
  // O commit no container não herda o gitconfig do host.
  git(worktree, "config", "user.name", "Auditor");
  git(worktree, "config", "user.email", "auditor@exemplo.com");
  for (const [nome, conteudo] of [
    ["velho.txt", "a\nb\nc\nd\ne\nf\n"],
    ["mod.txt", "m\n"],
    ["del.txt", "d\n"],
    ["bin.dat", "\0\x01"],
    ["link", "alvo\n"],
  ] as const) {
    writeFileSync(join(worktree, nome), conteudo);
  }
  git(worktree, "add", ".");
  git(worktree, "commit", "-q", "-m", "inicial");
  for (const [nome, corpo] of Object.entries(hooks)) {
    writeFileSync(join(worktree, ".git", "hooks", nome), `#!/bin/sh\n${corpo}\n`);
    chmodSync(join(worktree, ".git", "hooks", nome), 0o755);
  }
  return { worktree, head: () => git(worktree, "rev-parse", "HEAD").trim() };
}

test("commita com os hooks, sem credenciais, e as listas do git dão cada arquivo mudado", async () => {
  const env = join(base, "env-do-hook");
  const c = cenario({
    "pre-commit": `env > "${env}"`,
    "commit-msg": `printf '\\nRevisado-por: hook\\n' >> "$1"`,
  });
  const antes = c.head();
  git(c.worktree, "mv", "velho.txt", "novo é.txt");
  writeFileSync(join(c.worktree, "novo é.txt"), "a\nb\nc\nd\ne\nf\ng\n");
  writeFileSync(join(c.worktree, "mod.txt"), "m\nmm\n");
  unlinkSync(join(c.worktree, "del.txt"));
  writeFileSync(join(c.worktree, "bin.dat"), "\0\x02\x03");
  unlinkSync(join(c.worktree, "link"));
  symlinkSync("mod.txt", join(c.worktree, "link"));
  writeFileSync(join(c.worktree, "tab\tx.txt"), "n\n");

  git(c.worktree, "add", "-A");
  await commitar(ambiente, c.worktree, "fix: Cache na busca", { emendar: false, semAlteracao: false }, LIMITE_MS);

  assert.equal(git(c.worktree, "rev-parse", "HEAD~1").trim(), antes);
  assert.equal(
    git(c.worktree, "show", "-s", "--format=%B", "HEAD").trimEnd(),
    "fix: Cache na busca\n\nRevisado-por: hook",
  );
  assert.equal(git(c.worktree, "status", "--porcelain"), "");
  const mudou = (formato: string) => git(c.worktree, "show", "-z", "-M", formato, "--format=", "HEAD");
  assert.deepEqual(arquivosDe(mudou("--name-status"), mudou("--numstat")), [
    { caminho: "bin.dat", status: "M", adicionadas: null, removidas: null },
    { caminho: "del.txt", status: "D", adicionadas: 0, removidas: 1 },
    { caminho: "link", status: "M", adicionadas: 1, removidas: 1 },
    { caminho: "mod.txt", status: "M", adicionadas: 1, removidas: 0 },
    { caminho: "novo é.txt", caminhoAnterior: "velho.txt", status: "R", adicionadas: 1, removidas: 0 },
    { caminho: "tab\tx.txt", status: "A", adicionadas: 1, removidas: 0 },
  ]);
  // O hook rodou sem as credenciais e com gh e az olhando um diretório vazio, que já foi apagado.
  const doHook = readFileSync(env, "utf8");
  assert.doesNotMatch(doHook, /segredo/);
  const dir = /^GH_CONFIG_DIR=(.*)$/m.exec(doHook)?.[1];
  assert.match(String(dir), /fabriquinha-commit-/);
  assert.match(doHook, new RegExp(`^AZURE_CONFIG_DIR=${String(dir)}$`, "m"));
});

test("hook que reprova, ou passa do limite, reprova o ticket com o fim da saída, sem commit", async () => {
  const c = cenario({ "pre-commit": `echo "lint: 2 erros em mod.txt"; echo "${"y".repeat(2000)}" >&2; exit 1` });
  const antes = c.head();
  writeFileSync(join(c.worktree, "mod.txt"), "mudou\n");
  const dica = "corrija o que a saída aponta e execute o ticket de novo; a Fabriquinha nunca pula os hooks";
  git(c.worktree, "add", "-A");
  const commitarSemEmendar = (limiteMs: number) =>
    commitar(ambiente, c.worktree, "fix: mudou", { emendar: false, semAlteracao: false }, limiteMs);
  await assert.rejects(commitarSemEmendar(LIMITE_MS), (e) => {
    assert.ok(e instanceof ErroDeReprovacao);
    assert.equal(
      e.message,
      `o git commit saiu com código 1, com os hooks do repositório: ${"y".repeat(1500)} (${dica})`,
    );
    return true;
  });
  assert.equal(c.head(), antes);

  writeFileSync(join(c.worktree, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho comecei\nexec sleep 5\n");
  await assert.rejects(
    commitarSemEmendar(300),
    new ErroExterno("o git commit passou de 0.005 minutos, com os hooks do repositório: comecei", dica),
  );
  assert.equal(c.head(), antes);
});

test("listas do git que não casam por caminho: lança em vez de gravar os números de um arquivo no outro", () => {
  assert.deepEqual(arquivosDe("R090\0a\0b\0M\0c\0", "1\t0\t\0a\0b\0" + "2\t1\tc\0"), [
    { caminho: "b", caminhoAnterior: "a", status: "R", adicionadas: 1, removidas: 0 },
    { caminho: "c", status: "M", adicionadas: 2, removidas: 1 },
  ]);
  const dica = "confira a versão do git e execute o ticket de novo";
  assert.throws(
    () => arquivosDe("M\0a\0", "1\t0\tb\0"),
    new ErroDeRegra("as listas de arquivos do commit não casam: a no --name-status, b no --numstat", dica),
  );
  assert.throws(
    () => arquivosDe("R090\0a\0b\0", "1\t0\t\0a\0c\0"),
    new ErroDeRegra("as listas de arquivos do commit não casam: b no --name-status, c no --numstat", dica),
  );
  assert.throws(
    () => arquivosDe("M\0a\0", ""),
    new ErroDeRegra("as listas de arquivos do commit não casam: a no --name-status, undefined no --numstat", dica),
  );
});

test("sem alteração, o commit sai vazio; emendar refaz a HEAD em vez de empilhar", async () => {
  const c = cenario();
  const antes = c.head();
  await commitar(ambiente, c.worktree, "fix: vazio", { emendar: false, semAlteracao: true }, LIMITE_MS);
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1").trim(), antes);
  await commitar(ambiente, c.worktree, "fix: emendado", { emendar: true, semAlteracao: true }, LIMITE_MS);
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1").trim(), antes);
  assert.equal(git(c.worktree, "show", "-s", "--format=%B", "HEAD").trim(), "fix: emendado");
});

test("no container, o hook roda com o env limpo, sem diretório vazio de gh e az; hook que reprova é reprovação e o que trava é infraestrutura, morto no container", async () => {
  const docker = instalarDockerFalso(join(base, "docker"));
  const { id: container_id } = docker.semearContainer({});
  const ambienteContainer = new AmbienteContainer({
    id: "amb-commit",
    container_id,
    bin_do_pacote: join(base, "pacote-pi", "bin"),
    raiz: base,
    url_da_api: "http://host.docker.internal:3000",
  });
  process.env.SSH_AUTH_SOCK = "/tmp/ssh-do-host";
  const env = join(base, "env-do-hook-no-container");
  const c = cenario({ "pre-commit": `env > "${env}"` });
  git(c.worktree, "commit", "-q", "--allow-empty", "-m", "base");
  await commitar(ambienteContainer, c.worktree, "fix: no container", { emendar: false, semAlteracao: true }, LIMITE_MS);
  const doHook = readFileSync(env, "utf8");
  assert.doesNotMatch(doHook, /segredo|SSH_AUTH_SOCK|^GH_|^AZURE_|^SONAR_/m);

  const dica = "corrija o que a saída aponta e execute o ticket de novo; a Fabriquinha nunca pula os hooks";
  const hooks = join(c.worktree, ".git", "hooks", "pre-commit");
  writeFileSync(hooks, '#!/bin/sh\necho "lint: 2 erros"\nexit 1\n');
  await assert.rejects(
    commitar(ambienteContainer, c.worktree, "fix: reprova", { emendar: false, semAlteracao: true }, LIMITE_MS),
    (e) =>
      e instanceof ErroDeReprovacao &&
      e.message.startsWith("o git commit saiu com código 1, com os hooks do repositório:") &&
      e.message.endsWith(`lint: 2 erros (${dica})`),
  );

  writeFileSync(hooks, "#!/bin/sh\necho comecei\nexec sleep 3\n");
  await assert.rejects(
    commitar(ambienteContainer, c.worktree, "fix: trava", { emendar: false, semAlteracao: true }, 300),
    (e) => e instanceof ErroExterno && e.message.startsWith("o git commit passou de 0.005 minutos"),
  );
  assert.ok(
    docker
      .registro()
      .some(
        ([comando, alvo, , , roteiro]) =>
          comando === "exec" && alvo === container_id && String(roteiro).startsWith("kill -KILL"),
      ),
  );
});

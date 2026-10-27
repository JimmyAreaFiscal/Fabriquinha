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
import { ErroDeRegra, ErroDeReprovacao, ErroExterno } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarCommit } from "../persistencia/commits.ts";
import { registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { arquivosDe, commitarTicket, mensagemDoCommit } from "./commit.ts";
import { caminhoDaWorktree } from "./worktree.ts";

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

const issue = { id: 1, tipo: "problema" as const };
const ticket = { id: 3, titulo: "Cache na busca", descricao: "" };

let n = 0;
/** Banco e worktree da I-1 do projeto `loja`, com um commit inicial publicado e os `hooks` dados (nome → corpo). */
function cenario(hooks: Record<string, string> = {}) {
  const raiz = join(base, `raiz${String(++n)}`);
  const worktree = caminhoDaWorktree(raiz, "loja", 1);
  mkdirSync(worktree, { recursive: true });
  git(worktree, "init", "-q");
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
  // A base publicada: o commit inicial está numa branch remota.
  git(worktree, "update-ref", "refs/remotes/origin/main", "HEAD");
  for (const [nome, corpo] of Object.entries(hooks)) {
    writeFileSync(join(worktree, ".git", "hooks", nome), `#!/bin/sh\n${corpo}\n`);
    chmodSync(join(worktree, ".git", "hooks", nome), 0o755);
  }
  return { banco: abrir(raiz), worktree, head: () => git(worktree, "rev-parse", "HEAD").trim() };
}

test("mensagem: feat ou fix, título com issue e ticket, e a descrição quebrada em 72 colunas", () => {
  assert.equal(mensagemDoCommit(issue, ticket), "fix: Cache na busca [I-1/T-3]");
  const longa = `Uma linha bem comprida que passa das setenta e duas colunas e precisa quebrar ${"x".repeat(80)} fim.  `;
  assert.equal(
    mensagemDoCommit(
      { id: 12, tipo: "funcionalidade" },
      { id: 40, titulo: "Busca", descricao: `\n- item curto   \n\n${longa}\n` },
    ),
    [
      "feat: Busca [I-12/T-40]",
      "",
      "- item curto",
      "",
      "Uma linha bem comprida que passa das setenta e duas colunas e precisa",
      "quebrar",
      "x".repeat(80),
      "fim.",
    ].join("\n"),
  );
});

test("commita tudo com os hooks, sem credenciais, e devolve sha, mensagem lida de volta e cada arquivo mudado", async () => {
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

  const commit = await commitarTicket(c.banco, "loja", issue, { ...ticket, descricao: "Lê do cache." });

  assert.equal(commit.sha, c.head());
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1").trim(), antes);
  assert.equal(commit.mensagem, "fix: Cache na busca [I-1/T-3]\n\nLê do cache.\n\nRevisado-por: hook");
  assert.equal(git(c.worktree, "status", "--porcelain"), "");
  assert.ok(!Number.isNaN(Date.parse(commit.em)));
  assert.deepEqual(commit.arquivos, [
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

test("sem nada para commitar, sobre a base: commit vazio do ticket; sem registro, a retomada emenda o vazio", async () => {
  const c = cenario();
  const antes = c.head();
  const commit = await commitarTicket(c.banco, "loja", issue, ticket);
  assert.equal(commit.sha, c.head());
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1").trim(), antes);
  assert.equal(commit.mensagem, "fix: Cache na busca [I-1/T-3]");
  assert.deepEqual(commit.arquivos, []);

  const retomado = await commitarTicket(c.banco, "loja", issue, ticket);
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1").trim(), antes, "emendou, não empilhou");
  assert.deepEqual(retomado.arquivos, []);
});

test("hook que reprova, ou passa do limite, reprova o ticket com o fim da saída, sem commit", async () => {
  const c = cenario({ "pre-commit": `echo "lint: 2 erros em mod.txt"; echo "${"y".repeat(2000)}" >&2; exit 1` });
  const antes = c.head();
  writeFileSync(join(c.worktree, "mod.txt"), "mudou\n");
  const dica = "corrija o que a saída aponta e execute o ticket de novo; a Fabriquinha nunca pula os hooks";
  await assert.rejects(commitarTicket(c.banco, "loja", issue, ticket), (e) => {
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
    commitarTicket(c.banco, "loja", issue, ticket, 300),
    new ErroExterno("o git commit passou de 0.005 minutos, com os hooks do repositório: comecei", dica),
  );
  assert.equal(c.head(), antes);
});

test("sem nada para commitar, com a HEAD num commit do próprio agente: diz que ele commitou e como desfazer", async () => {
  const c = cenario();
  writeFileSync(join(c.worktree, "mod.txt"), "do agente\n");
  git(c.worktree, "commit", "-q", "-am", "wip");
  const head = c.head();
  await assert.rejects(
    commitarTicket(c.banco, "loja", issue, ticket),
    new ErroDeRegra(
      "o ticket de desenvolvimento não deixou alteração para commitar, e a HEAD da worktree é o commit " +
        `${head.slice(0, 12)}, que nenhum ticket registrou: o agente commitou por conta própria`,
      `devolva o trabalho ao stage com git -C ${c.worktree} reset --soft HEAD~1 (repita até a HEAD ser um commit da ` +
        "Fabriquinha ou da base; num merge da base, refaça-o com git merge --no-commit) e execute o ticket de novo",
    ),
  );
  assert.equal(c.head(), head, "a Fabriquinha não desfaz o commit do agente");
});

test("retomada: HEAD com a marca do próprio ticket é emendada com os hooks, e um merge continua merge", async () => {
  const c = cenario({ "pre-commit": `echo rodou >> "${join(base, "hook-retomada")}"` });
  const inicial = c.head();
  // Um merge da base que o agente deixou sem commit e o nosso commit, que o C7 não chegou a registrar.
  git(c.worktree, "checkout", "-q", "-b", "lado");
  writeFileSync(join(c.worktree, "lado.txt"), "l\n");
  git(c.worktree, "add", "lado.txt");
  git(c.worktree, "commit", "-q", "-m", "lado");
  git(c.worktree, "checkout", "-q", "-");
  git(c.worktree, "merge", "-q", "--no-ff", "--no-commit", "lado");
  git(c.worktree, "commit", "-q", "-m", "fix: Cache na busca [I-1/T-3]");
  // Na nova execução, o agente ainda muda um arquivo.
  writeFileSync(join(c.worktree, "mod.txt"), "m\nmais\n");
  writeFileSync(join(base, "hook-retomada"), "");

  const commit = await commitarTicket(c.banco, "loja", issue, ticket);

  assert.equal(commit.sha, c.head());
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1").trim(), inicial, "emendou, não empilhou");
  assert.equal(git(c.worktree, "log", "-1", "--format=%P").trim().split(" ").length, 2, "continua merge");
  assert.equal(commit.mensagem, "fix: Cache na busca [I-1/T-3]");
  assert.deepEqual(
    commit.arquivos.map((a) => [a.caminho, a.status]),
    [
      ["lado.txt", "A"],
      ["mod.txt", "M"],
    ],
  );
  assert.equal(readFileSync(join(base, "hook-retomada"), "utf8"), "rodou\n", "os hooks rodaram de novo");
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

test("commit registrado de outro ticket que cita a marca no corpo não é órfão", async () => {
  const c = cenario();
  writeFileSync(join(c.worktree, "mod.txt"), "do T-4\n");
  git(c.worktree, "commit", "-q", "-am", "fix: Métrica [I-1/T-4]\n\nTermina o que [I-1/T-3] começou.");
  // Registrado no T-1, o único ticket do banco: a FK só pede um ticket que exista.
  registrarProjeto(c.banco, {
    nome: "loja",
    repo: "/repos/loja",
    branchBase: "main",
    hospedagem: "github",
    testes: ["true"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  });
  registrarIssue(c.banco, { projeto: "loja" }, { tipo: "auditor" });
  const doT4 = c.head();
  gravarCommit(c.banco, 1, { sha: doT4, mensagem: "m", em: "2026-10-11T12:00:00.000Z", arquivos: [] });

  await commitarTicket(c.banco, "loja", issue, ticket);
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1").trim(), doT4, "commit vazio por cima, sem emendar o do T-4");
});

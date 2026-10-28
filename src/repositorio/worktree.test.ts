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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { descartarAlteracoes, exigirGit, naFilaDoProjeto, preparar, removerWorktrees } from "./worktree.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-worktree-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// git sem a configuração do usuário da máquina.
const globalVazio = join(base, "gitconfig");
writeFileSync(globalVazio, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = globalVazio;
process.env.GIT_CONFIG_NOSYSTEM = "1";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const commitar = (repo: string, arquivo: string, conteudo: string) => {
  writeFileSync(join(repo, arquivo), conteudo);
  git(repo, "add", arquivo);
  git(repo, "commit", "-q", "-m", arquivo);
  return git(repo, "rev-parse", "HEAD");
};

let n = 0;
/**
 * Clone com `origin` bare local e `main` publicada com um `.gitignore` de `node_modules/`, uma raiz e um log novos, e a
 * worktree `<raiz>/worktrees/loja/I-1`, na branch `fabriquinha/I-1`.
 */
function cenario() {
  const dir = join(base, `c${String(++n)}`);
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const raiz = join(dir, "raiz");
  const worktree = join(raiz, "worktrees", "loja", "I-1");
  mkdirSync(join(raiz, "execucoes", "E-1"), { recursive: true });
  git(base, "init", "-q", "--bare", bare);
  git(base, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  commitar(repo, ".gitignore", "node_modules/\n");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "worktree", "add", "-q", "-b", "fabriquinha/I-1", worktree);
  const log = join(raiz, "execucoes", "E-1", "log");
  return { repo, raiz, worktree, log, lerLog: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

test("preparação que falha para no primeiro erro, vai para o log e roda de novo na próxima vez", async () => {
  const sinal = join(base, "pode-preparar");
  const segundo = join(base, "segundo-rodou");
  const c = cenario();
  const comandos = [`echo tentando; test -f ${sinal}`, `touch ${segundo}`];
  const falha = (erro: unknown) =>
    erro instanceof ErroDeRegra &&
    erro.message ===
      `a preparação da worktree falhou em "echo tentando; test -f ${sinal}": saiu com código 1 ` +
        `(veja o log em ${c.log}; ela roda de novo na próxima execução)`;

  await assert.rejects(preparar(c.worktree, comandos, c.log), falha);
  assert.equal(existsSync(segundo), false);
  assert.match(c.lerLog(), /tentando\n.*preparação falhou: saiu com código 1\n$/s);

  writeFileSync(sinal, "");
  await preparar(c.worktree, comandos, c.log);
  assert.equal(existsSync(segundo), true);
  assert.equal(c.lerLog().match(/^tentando$/gm)?.length, 2);
});

test("erro de sintaxe na preparação vai para o log", async () => {
  const c = cenario();
  await assert.rejects(preparar(c.worktree, ["npm test ("], c.log), /saiu com código 2/);
  assert.match(c.lerLog(), /preparação: npm test \(\n.*syntax error.*preparação falhou: saiu com código 2\n$/is);
});

test("comando de preparação que passa de 30 minutos é morto e a preparação falha", async (t) => {
  const c = cenario();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resultado: unknown;
  const pedido = preparar(c.worktree, ["sleep 600"], c.log).catch((erro: unknown) => (resultado = erro));
  // O relógio falso anda um minuto por volta do laço de eventos real, depois que o comando começou.
  let minutos = 0;
  while (resultado === undefined) {
    await new Promise((pronto) => setImmediate(pronto));
    if (existsSync(c.log)) {
      t.mock.timers.tick(60_000);
      minutos++;
    }
  }
  await pedido;
  assert.ok(resultado instanceof ErroDeRegra);
  assert.match(resultado.message, /^a preparação da worktree falhou em "sleep 600": passou de 30 minutos/);
  assert.ok(minutos >= 30);
});

test("comando git que falha vira ErroDeRegra com a saída do git", async () => {
  const c = cenario();
  await assert.rejects(
    exigirGit(c.repo, "fetch", "origin", "+refs/heads/nao-existe:refs/remotes/origin/nao-existe"),
    (erro: unknown) =>
      erro instanceof ErroDeRegra &&
      /^git fetch origin .* falhou em .*: fatal: couldn't find remote ref/.test(erro.message),
  );
});

test("descarte: reset --hard + clean -fd mantém ignorados, remove o novo e anota no log o que removeu", async () => {
  const c = cenario();
  const caminho = c.worktree;
  mkdirSync(join(caminho, "node_modules", "pacote"), { recursive: true });
  writeFileSync(join(caminho, "node_modules", "pacote", "index.js"), "");
  mkdirSync(join(caminho, "pasta nova"));
  writeFileSync(join(caminho, "pasta nova", "x.txt"), "");
  writeFileSync(join(caminho, "rascunho-ç.md"), "");
  writeFileSync(join(caminho, ".gitignore"), "alterado\n");

  assert.deepEqual(await descartarAlteracoes(caminho, c.log), ["pasta nova/", "rascunho-ç.md"]);
  assert.equal(existsSync(join(caminho, "node_modules", "pacote", "index.js")), true);
  assert.equal(existsSync(join(caminho, "rascunho-ç.md")), false);
  assert.equal(readFileSync(join(caminho, ".gitignore"), "utf8"), "node_modules/\n");
  assert.match(c.lerLog(), /descarte removeu: pasta nova\/, rascunho-ç\.md\n$/);

  const antes = c.lerLog();
  assert.deepEqual(await descartarAlteracoes(caminho, c.log), []);
  assert.equal(c.lerLog(), antes);
});

test("fila por projeto: mesmo projeto em série (mesmo depois de uma falha), projetos diferentes em paralelo", async () => {
  const eventos: string[] = [];
  const passo =
    (nome: string, falhar = false) =>
    async () => {
      eventos.push(`${nome}+`);
      await new Promise((pronto) => setImmediate(pronto));
      eventos.push(`${nome}-`);
      if (falhar) throw new Error(nome);
      return nome;
    };
  const raiz = join(base, "raiz-fila");
  const a1 = naFilaDoProjeto(raiz, "a", passo("a1", true));
  const a2 = naFilaDoProjeto(`${raiz}/`, "a", passo("a2"));
  const b1 = naFilaDoProjeto(raiz, "b", passo("b1"));
  await assert.rejects(a1, /a1/);
  assert.equal(await a2, "a2");
  assert.equal(await b1, "b1");
  // b1 começa antes de a1 terminar; a2 só começa depois que a1 terminou.
  assert.deepEqual(eventos.slice(0, 3), ["a1+", "b1+", "a1-"]);
  assert.ok(eventos.indexOf("a2+") > eventos.indexOf("a1-"));
});

test("o descarte entra na mesma fila do projeto que a worktree", async () => {
  const c = cenario();
  const caminho = c.worktree;
  writeFileSync(join(caminho, "novo.txt"), "");
  const eventos: string[] = [];
  const ocupada = naFilaDoProjeto(c.raiz, "loja", async () => {
    eventos.push("fila+");
    await new Promise((pronto) => setTimeout(pronto, 50));
    eventos.push("fila-");
  });
  const descarte = descartarAlteracoes(caminho, c.log).then(() => eventos.push("descarte"));
  await Promise.all([ocupada, descarte]);
  assert.deepEqual(eventos, ["fila+", "fila-", "descarte"]);
});

test("removerWorktrees: apaga worktrees/<projeto> e faz prune; repositório, HEAD, branch e outros projetos ficam", async () => {
  const c = cenario();
  mkdirSync(join(c.raiz, "worktrees", "outro"), { recursive: true });
  const head = git(c.repo, "rev-parse", "HEAD");

  assert.deepEqual(await removerWorktrees(c.raiz, { nome: "loja", repo: c.repo }), []);

  assert.equal(existsSync(join(c.raiz, "worktrees", "loja")), false);
  assert.equal(existsSync(join(c.raiz, "worktrees", "outro")), true);
  assert.doesNotMatch(git(c.repo, "worktree", "list"), /I-1/);
  assert.match(git(c.repo, "branch", "--list", "fabriquinha/I-1"), /fabriquinha\/I-1/);
  assert.equal(git(c.repo, "rev-parse", "HEAD"), head);
});

test("removerWorktrees: sem worktrees/<projeto> no disco devolve []", async () => {
  const c = cenario();
  assert.deepEqual(await removerWorktrees(c.raiz, { nome: "demo", repo: c.repo }), []);
});

test("removerWorktrees: repositório que não existe mais vira o aviso do prune", async () => {
  const c = cenario();
  const repo = join(c.raiz, "sumiu");
  const avisos = await removerWorktrees(c.raiz, { nome: "demo", repo });
  assert.equal(avisos.length, 1);
  assert.match(String(avisos[0]), new RegExp(`^git -C ${repo} worktree prune falhou: .+`));
});

test(
  "removerWorktrees: pasta que não dá para apagar vira aviso com o caminho",
  { skip: process.getuid?.() === 0 },
  async (t) => {
    const c = cenario();
    const pasta = join(c.raiz, "worktrees", "demo");
    const interna = join(pasta, "I-1");
    mkdirSync(interna, { recursive: true });
    writeFileSync(join(interna, "a.txt"), "");
    chmodSync(interna, 0o500);
    t.after(() => {
      chmodSync(interna, 0o700);
    });

    const avisos = await removerWorktrees(c.raiz, { nome: "demo", repo: c.repo });
    assert.equal(avisos.length, 1);
    assert.match(String(avisos[0]), new RegExp(`^não foi possível apagar ${pasta}: `));
  },
);

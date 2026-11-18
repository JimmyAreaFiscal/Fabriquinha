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
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ComandoNoAmbiente } from "../../../ambiente/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { exigirGit, naFilaDoProjeto } from "../../git/publico.ts";
import { descartarAlteracoes, preparar, removerWorktrees } from "./worktree.ts";
import { AmbienteHostLocal } from "../../../../../apoio-testes/falsos/ambiente_falso.ts";

const ambiente = new AmbienteHostLocal();

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
  commitar(repo, ".gitignore", "node_modules\n");
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

  await assert.rejects(preparar(ambiente, c.worktree, { preparacao: comandos, instalacao: [] }, c.log), falha);
  assert.equal(existsSync(segundo), false);
  assert.match(c.lerLog(), /tentando\n.*preparação falhou: saiu com código 1\n$/s);

  writeFileSync(sinal, "");
  await preparar(ambiente, c.worktree, { preparacao: comandos, instalacao: [] }, c.log);
  assert.equal(existsSync(segundo), true);
  assert.equal(c.lerLog().match(/^tentando$/gm)?.length, 2);
});

/** Um Ambiente que já traz as dependências: `/dependencias` é, aqui, a pasta dada. */
class AmbienteComDependencias extends AmbienteHostLocal {
  readonly #pastaDasDependencias: string;
  constructor(pastaDasDependencias: string) {
    super();
    Object.defineProperty(this, "trazDependenciasInstaladas", { value: true });
    this.#pastaDasDependencias = pastaDasDependencias;
  }
  override executar(comando: ComandoNoAmbiente) {
    return super.executar({
      ...comando,
      programa: comando.programa.replaceAll("/dependencias", this.#pastaDasDependencias),
    });
  }
}

test("no host local a instalação roda antes da preparação", async () => {
  const c = cenario();
  await preparar(ambiente, c.worktree, { instalacao: ["echo instalou"], preparacao: ["echo preparou"] }, c.log);
  assert.match(c.lerLog(), /preparação: echo instalou\ninstalou\n.*preparação: echo preparou\npreparou\n$/);
});

/** A pasta que faz de `/dependencias` com `node_modules`, `package.json` e `package-lock.json`; o lockfile da worktree vem de `lockfileDaWorktree`. */
function dependenciasDaImagem(worktree: string, lockfileDaWorktree: string) {
  const dependencias = join(base, `dependencias${String(n)}`);
  mkdirSync(join(dependencias, "node_modules"), { recursive: true });
  writeFileSync(join(dependencias, "node_modules", "pacote.txt"), "ok");
  writeFileSync(join(dependencias, "package.json"), "{}");
  writeFileSync(join(dependencias, "package-lock.json"), "lock-da-imagem");
  commitar(worktree, "package.json", "{}");
  commitar(worktree, "package-lock.json", lockfileDaWorktree);
  return new AmbienteComDependencias(dependencias);
}

test("com as dependências no Ambiente e o mesmo lockfile a instalação é pulada, a preparação roda e a worktree enxerga node_modules", async () => {
  const c = cenario();
  const comDependencias = dependenciasDaImagem(c.worktree, "lock-da-imagem");
  await preparar(comDependencias, c.worktree, { instalacao: ["echo instalou"], preparacao: ["echo preparou"] }, c.log);
  assert.doesNotMatch(c.lerLog(), /instalou/);
  assert.match(c.lerLog(), /preparou\n$/);
  assert.equal(readFileSync(join(c.worktree, "node_modules", "pacote.txt"), "utf8"), "ok");
  // O .gitignore ignora o symlink e o descarte (clean -fd sem -x) o mantém.
  assert.equal(git(c.worktree, "status", "--short"), "");
  await descartarAlteracoes(ambiente, c.worktree, c.log);
  assert.equal(readFileSync(join(c.worktree, "node_modules", "pacote.txt"), "utf8"), "ok");
});

test("com as dependências no Ambiente e lockfile diferente a instalação roda na worktree e nada é ligado à imagem", async () => {
  const c = cenario();
  const comDependencias = dependenciasDaImagem(c.worktree, "lock-da-demanda");
  await preparar(comDependencias, c.worktree, { instalacao: ["echo instalou"], preparacao: ["echo preparou"] }, c.log);
  assert.match(c.lerLog(), /preparação: echo instalou\ninstalou\n.*preparação: echo preparou\npreparou\n$/);
  assert.equal(existsSync(join(c.worktree, "node_modules")), false);
});

test("o symlink de uma preparação anterior é trocado pela instalação local quando o lockfile muda", async () => {
  const c = cenario();
  const comDependencias = dependenciasDaImagem(c.worktree, "lock-da-imagem");
  const verificacoes = { instalacao: ["mkdir node_modules && touch node_modules/local.txt"], preparacao: [] };
  await preparar(comDependencias, c.worktree, verificacoes, c.log);
  assert.equal(existsSync(join(c.worktree, "node_modules", "pacote.txt")), true);
  assert.equal(existsSync(join(c.worktree, "node_modules", "local.txt")), false);

  commitar(c.worktree, "package-lock.json", "lock-novo");
  await preparar(comDependencias, c.worktree, verificacoes, c.log);
  assert.equal(existsSync(join(c.worktree, "node_modules", "local.txt")), true);
  assert.equal(existsSync(join(c.worktree, "node_modules", "pacote.txt")), false);
});

test("com as dependências no Ambiente, imagem sem /dependencias/node_modules não liga nada e não falha", async () => {
  const c = cenario();
  const semNodeModules = join(base, `sem-node-modules${String(n)}`);
  mkdirSync(semNodeModules);
  await preparar(new AmbienteComDependencias(semNodeModules), c.worktree, { instalacao: [], preparacao: [] }, c.log);
  assert.equal(existsSync(join(c.worktree, "node_modules")), false);
});

test("erro de sintaxe na preparação vai para o log", async () => {
  const c = cenario();
  await assert.rejects(
    preparar(ambiente, c.worktree, { preparacao: ["npm test ("], instalacao: [] }, c.log),
    /saiu com código 2/,
  );
  assert.match(c.lerLog(), /preparação: npm test \(\n.*syntax error.*preparação falhou: saiu com código 2\n$/is);
});

test("comando de preparação que passa de 30 minutos é morto e a preparação falha", async (t) => {
  const c = cenario();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resultado: unknown;
  const pedido = preparar(ambiente, c.worktree, { preparacao: ["sleep 600"], instalacao: [] }, c.log).catch(
    (erro: unknown) => (resultado = erro),
  );
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

test("git do core não executa hook nem comando de execução que o repositório (escrito pelo container) define", async () => {
  const c = cenario();
  const marca = join(c.raiz, "executou");
  const gravaMarca = `#!/bin/sh\necho $0 >> ${marca}\n`;
  mkdirSync(join(c.repo, ".git", "hooks"), { recursive: true });
  const prePush = join(c.repo, ".git", "hooks", "pre-push");
  writeFileSync(prePush, gravaMarca);
  chmodSync(prePush, 0o755);
  const comando = join(c.raiz, "comando.sh");
  writeFileSync(comando, gravaMarca);
  chmodSync(comando, 0o755);
  git(c.repo, "config", "core.fsmonitor", comando);
  git(c.repo, "config", "core.sshCommand", comando);
  git(c.repo, "remote", "add", "remoto-ssh", "ssh://exemplo.invalido/repo.git");

  await exigirGit(c.repo, "push", "origin", "main");
  await exigirGit(c.repo, "fetch", "origin");
  await exigirGit(c.repo, "status");
  await assert.rejects(exigirGit(c.repo, "ls-remote", "remoto-ssh"), ErroDeRegra);

  assert.equal(existsSync(marca), false);
});

/** Roda `corpo` com o git do usuário sendo `conteudoGlobal` (o caminho do arquivo é passado a quem monta o conteúdo). */
async function comGitGlobal(conteudoGlobal: (arquivo: string) => string, corpo: () => Promise<void>) {
  const arquivo = join(base, `gitconfig-${String(++n)}`);
  writeFileSync(arquivo, conteudoGlobal(arquivo));
  const original = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = arquivo;
  try {
    await corpo();
  } finally {
    process.env.GIT_CONFIG_GLOBAL = original;
  }
}

function criarScriptQueGravaMarca(c: { raiz: string }, nome: string) {
  const marca = join(c.raiz, `${nome}.marca`);
  const script = join(c.raiz, `${nome}.sh`);
  writeFileSync(script, `#!/bin/sh\necho "$@" >> ${marca}\necho username=u\necho password=p\n`);
  chmodSync(script, 0o755);
  return { marca, script };
}

/** Servidor HTTP que exige credencial: responde 401 sem Authorization e 404 com ela. */
async function comServidorQueExigeCredencial(corpo: (url: string) => Promise<void>) {
  const servidor = createServer((req, res) => {
    res.writeHead(req.headers.authorization ? 404 : 401, { "WWW-Authenticate": "Basic realm=teste" }).end();
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  try {
    await corpo(`http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}`);
  } finally {
    servidor.close();
  }
}

test("git do core usa o credential.<url>.helper do config do usuário e ignora o que só o repositório define", async () => {
  const c = cenario();
  const { marca, script } = criarScriptQueGravaMarca(c, "helper");
  await comServidorQueExigeCredencial(async (servidor) => {
    const url = `${servidor}/repo.git`;
    git(c.repo, "config", `credential.${servidor}.helper`, script);
    await assert.rejects(exigirGit(c.repo, "ls-remote", url), ErroDeRegra);
    assert.equal(existsSync(marca), false);

    await comGitGlobal(
      () => `[credential "${servidor}"]\n\thelper = ${script}\n`,
      async () => {
        await assert.rejects(exigirGit(c.repo, "ls-remote", url), ErroDeRegra);
        assert.match(readFileSync(marca, "utf8"), /get/);
      },
    );
  });
});

test("git do core usa o core.sshCommand que o config do usuário define para o diretório do repositório", async () => {
  const c = cenario();
  const { marca, script } = criarScriptQueGravaMarca(c, "ssh");
  git(c.repo, "remote", "add", "remoto-ssh", "ssh://exemplo.invalido/repo.git");
  await comGitGlobal(
    (arquivo) => {
      const incluido = `${arquivo}.ssh`;
      writeFileSync(incluido, `[core]\n\tsshCommand = ${script}\n`);
      return `[includeIf "gitdir:${c.repo}/.git"]\n\tpath = ${incluido}\n`;
    },
    async () => {
      await assert.rejects(exigirGit(c.repo, "ls-remote", "remoto-ssh"), ErroDeRegra);
      assert.match(readFileSync(marca, "utf8"), /exemplo\.invalido/);
    },
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

  assert.deepEqual(await descartarAlteracoes(ambiente, caminho, c.log), ["pasta nova/", "rascunho-ç.md"]);
  assert.equal(existsSync(join(caminho, "node_modules", "pacote", "index.js")), true);
  assert.equal(existsSync(join(caminho, "rascunho-ç.md")), false);
  assert.equal(readFileSync(join(caminho, ".gitignore"), "utf8"), "node_modules\n");
  assert.match(c.lerLog(), /descarte removeu: pasta nova\/, rascunho-ç\.md\n$/);

  const antes = c.lerLog();
  assert.deepEqual(await descartarAlteracoes(ambiente, caminho, c.log), []);
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
  const descarte = descartarAlteracoes(ambiente, caminho, c.log).then(() => eventos.push("descarte"));
  await Promise.all([ocupada, descarte]);
  assert.deepEqual(eventos, ["fila+", "fila-", "descarte"]);
});

test("removerWorktrees: apaga worktrees/<projeto> e faz prune; repositório, HEAD, branch e outros projetos ficam", async () => {
  const c = cenario();
  mkdirSync(join(c.raiz, "worktrees", "outro"), { recursive: true });
  const head = git(c.repo, "rev-parse", "HEAD");

  assert.deepEqual(await removerWorktrees(c.raiz, { nome: "loja", raiz_git: c.repo }), []);

  assert.equal(existsSync(join(c.raiz, "worktrees", "loja")), false);
  assert.equal(existsSync(join(c.raiz, "worktrees", "outro")), true);
  assert.doesNotMatch(git(c.repo, "worktree", "list"), /I-1/);
  assert.match(git(c.repo, "branch", "--list", "fabriquinha/I-1"), /fabriquinha\/I-1/);
  assert.equal(git(c.repo, "rev-parse", "HEAD"), head);
});

test("removerWorktrees: sem worktrees/<projeto> no disco devolve []", async () => {
  const c = cenario();
  assert.deepEqual(await removerWorktrees(c.raiz, { nome: "demo", raiz_git: c.repo }), []);
});

test("removerWorktrees: repositório que não existe mais vira o aviso do prune", async () => {
  const c = cenario();
  const repo = join(c.raiz, "sumiu");
  const avisos = await removerWorktrees(c.raiz, { nome: "demo", raiz_git: repo });
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

    const avisos = await removerWorktrees(c.raiz, { nome: "demo", raiz_git: c.repo });
    assert.equal(avisos.length, 1);
    assert.match(String(avisos[0]), new RegExp(`^não foi possível apagar ${pasta}: `));
  },
);

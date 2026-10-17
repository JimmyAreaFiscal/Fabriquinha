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
import {
  caminhoDaWorktree,
  descartarAlteracoes,
  garantirWorktree,
  limpar,
  limpezaPendente,
  naFilaDoProjeto,
  removerWorktrees,
} from "./worktree.ts";

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

/** Gancho do F6 que não faz nada: estes testes não medem a varredura. */
const semVarredura = () => Promise.resolve();

let n = 0;
/** Clone com `origin` bare local, `main` publicada com um `.gitignore` de `node_modules/`, e uma raiz e um log novos. */
function cenario(preparacao: string[] = []) {
  const dir = join(base, `c${String(++n)}`);
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const raiz = join(dir, "raiz");
  mkdirSync(join(raiz, "execucoes", "E-1"), { recursive: true });
  git(base, "init", "-q", "--bare", bare);
  git(base, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  commitar(repo, ".gitignore", "node_modules/\n");
  git(repo, "push", "-q", "origin", "main");
  return {
    bare,
    repo,
    raiz,
    log: join(raiz, "execucoes", "E-1", "log"),
    projeto: { nome: "loja", repo, branchBase: "main", preparacao },
    issue: { id: 1, criadaEm: "2026-10-11T12:00:00.000Z" },
    lerLog: () =>
      existsSync(join(raiz, "execucoes", "E-1", "log"))
        ? readFileSync(join(raiz, "execucoes", "E-1", "log"), "utf8")
        : "",
  };
}

/** Publica um commit novo na base pelo bare, sem passar pelo clone do projeto: só um fetch o traz. */
function avancarOrigin(bare: string): string {
  const outro = mkdtempSync(join(base, "outro-"));
  git(base, "clone", "-q", "-b", "main", bare, outro);
  const sha = commitar(outro, "novo.txt", "da base\n");
  git(outro, "push", "-q", "origin", "main");
  return sha;
}

test("caminho da worktree: <raiz>/worktrees/<projeto>/I-<n>", () => {
  assert.equal(caminhoDaWorktree("/r", "loja", 12), "/r/worktrees/loja/I-12");
});

test("sem worktree nem branch: busca a base, cria fabriquinha/I-n a partir de origin/<base>, prepara em ordem e varre a base", async () => {
  const c = cenario(["echo um > a.txt && echo saída-um", "cat a.txt; echo dois >&2"]);
  const shaBase = avancarOrigin(c.bare);
  let varridas = 0;

  const caminho = await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, () => {
    varridas++;
    return Promise.resolve();
  });

  assert.equal(caminho, join(c.raiz, "worktrees", "loja", "I-1"));
  assert.equal(git(caminho, "rev-parse", "--abbrev-ref", "HEAD"), "fabriquinha/I-1");
  assert.equal(git(caminho, "rev-parse", "HEAD"), shaBase);
  assert.equal(varridas, 1);
  // /bin/sh -c com cwd na worktree, na ordem: o segundo comando lê o que o primeiro escreveu.
  assert.match(
    c.lerLog(),
    /preparação: echo um > a\.txt && echo saída-um\nsaída-um\n.*preparação: cat a\.txt; echo dois >&2\num\ndois\n$/s,
  );
});

test("worktree existente e preparada: devolve o caminho sem preparar nem buscar a base de novo", async () => {
  const contador = join(base, "contador-preparada");
  const c = cenario([`echo x >> ${contador}`]);
  let varridas = 0;
  const varrer = () => {
    varridas++;
    return Promise.resolve();
  };
  const caminho = await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, varrer);
  avancarOrigin(c.bare);

  assert.equal(await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, varrer), caminho);
  assert.equal(readFileSync(contador, "utf8"), "x\n");
  assert.equal(varridas, 1);
  assert.equal(git(c.repo, "rev-parse", "origin/main"), git(caminho, "rev-parse", "HEAD"));
});

test("pasta apagada à mão com a branch existente: recria a worktree na mesma branch e prepara de novo", async () => {
  const contador = join(base, "contador-apagada");
  const c = cenario([`echo x >> ${contador}`]);
  let varridas = 0;
  const varrer = () => {
    varridas++;
    return Promise.resolve();
  };
  const caminho = await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, varrer);
  const shaTicket = commitar(caminho, "ticket.txt", "trabalho do ticket\n");
  rmSync(caminho, { recursive: true });

  assert.equal(await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, varrer), caminho);
  assert.equal(git(caminho, "rev-parse", "HEAD"), shaTicket);
  assert.equal(readFileSync(contador, "utf8"), "x\nx\n");
  assert.equal(varridas, 1);
});

test("branch fabriquinha/I-n de sobra, que não pertence à issue, é recusada e fica intocada", async () => {
  const c = cenario();
  git(c.repo, "branch", "fabriquinha/I-1", "main");
  const sha = git(c.repo, "rev-parse", "fabriquinha/I-1");
  const recusa = (erro: unknown) =>
    erro instanceof ErroDeRegra &&
    erro.message ===
      `a branch fabriquinha/I-1 já existe em ${c.repo} e não pertence à I-1 desta Fabriquinha ` +
        `(se for sobra, remova-a com git -C ${c.repo} branch -D fabriquinha/I-1; a Fabriquinha nunca a sobrescreve)`;

  await assert.rejects(garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura), recusa);
  // A mesma branch criada para outra I-1 (outra instalação, outra raiz) também é sobra.
  git(c.repo, "config", "branch.fabriquinha/I-1.fabriquinha", `/outra/raiz/worktrees/loja/I-1 ${c.issue.criadaEm}`);
  await assert.rejects(garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura), recusa);

  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-1"), sha);
  assert.equal(existsSync(caminhoDaWorktree(c.raiz, "loja", 1)), false);
});

test("preparação que falha para no primeiro erro, vai para o log e roda de novo na próxima vez", async () => {
  const sinal = join(base, "pode-preparar");
  const segundo = join(base, "segundo-rodou");
  const c = cenario([`echo tentando; test -f ${sinal}`, `touch ${segundo}`]);
  const falha = (erro: unknown) =>
    erro instanceof ErroDeRegra &&
    erro.message ===
      `a preparação da worktree falhou em "echo tentando; test -f ${sinal}": saiu com código 1 ` +
        `(veja o log em ${c.log}; ela roda de novo na próxima execução)`;

  await assert.rejects(garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura), falha);
  assert.equal(existsSync(segundo), false);
  assert.match(c.lerLog(), /tentando\n.*preparação falhou: saiu com código 1\n$/s);

  writeFileSync(sinal, "");
  await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura);
  assert.equal(existsSync(segundo), true);
  assert.equal(c.lerLog().match(/^tentando$/gm)?.length, 2);
});

test("erro de sintaxe na preparação vai para o log", async () => {
  const c = cenario(["npm test ("]);
  await assert.rejects(garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura), /saiu com código 2/);
  assert.match(c.lerLog(), /preparação: npm test \(\n.*syntax error.*preparação falhou: saiu com código 2\n$/is);
});

test("comando de preparação que passa de 30 minutos é morto e a preparação falha", async (t) => {
  const c = cenario(["sleep 600"]);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resultado: unknown;
  const pedido = garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura).catch(
    (erro: unknown) => (resultado = erro),
  );
  // O relógio falso anda um minuto por volta do laço de eventos real: o git roda de verdade até o sleep começar.
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

test("falha do varrerBase só vai para o log", async () => {
  const c = cenario();
  const caminho = await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, () => Promise.reject(new Error("F6 fora")));
  assert.equal(existsSync(caminho), true);
  assert.match(c.lerLog(), /varrerBase falhou: Error: F6 fora\n$/);
});

test("comando git que falha vira ErroDeRegra com a saída do git", async () => {
  const c = cenario();
  await assert.rejects(
    garantirWorktree(c.raiz, { ...c.projeto, branchBase: "nao-existe" }, c.issue, c.log, semVarredura),
    (erro: unknown) =>
      erro instanceof ErroDeRegra &&
      /^git fetch origin .* falhou em .*: fatal: couldn't find remote ref/.test(erro.message),
  );
});

test("descarte: reset --hard + clean -fd mantém ignorados, remove o novo e anota no log o que removeu", async () => {
  const c = cenario();
  const caminho = await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura);
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
  const caminho = await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura);
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

test("limpar (F5 §5.3): varre a base, remove a worktree suja e faz prune; as branches local e remota ficam", async () => {
  const c = cenario();
  const worktree = await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura);
  writeFileSync(join(worktree, "sujo.txt"), "não commitado\n");
  git(worktree, "push", "-q", "-u", "origin", "fabriquinha/I-1");
  let varreuComWorktree: boolean | undefined;
  const varrer = () => {
    varreuComWorktree = existsSync(worktree);
    return Promise.resolve();
  };

  assert.deepEqual(await limpar(c.raiz, c.projeto, { id: 1, fase: "concluida" }, varrer), []);
  assert.equal(varreuComWorktree, true, "varreu a base antes de remover a worktree");
  assert.equal(existsSync(worktree), false);
  assert.doesNotMatch(git(c.repo, "worktree", "list"), /I-1/);
  assert.equal(git(c.repo, "branch", "--list", "fabriquinha/I-1"), "fabriquinha/I-1");
  assert.match(git(c.bare, "branch", "--list", "fabriquinha/I-1"), /fabriquinha\/I-1/);
});

test("limpar: falha da varredura vai só para o log; falha do git vira aviso com o comando", async (t) => {
  const c = cenario();
  const erros = t.mock.method(console, "error", () => undefined);
  const falhou = () => Promise.reject(new Error("git fetch falhou"));

  const avisos = await limpar(c.raiz, c.projeto, { id: 1, fase: "concluida" }, falhou);
  const caminho = caminhoDaWorktree(c.raiz, "loja", 1);
  assert.equal(avisos.length, 1, "o prune passa");
  assert.match(String(avisos[0]), new RegExp(`^git -C ${c.repo} worktree remove --force ${caminho} falhou: fatal: `));
  assert.match(String(erros.mock.calls[0]?.arguments[1]), /^varrerBase ao limpar a I-1 falhou: git fetch falhou$/);
});

/** Encerra a I-1 (sem worktree) com `origin/main` um commit à frente (`novo.txt`, "da base"), depois de `antes(repo)`. */
async function encerrarComOriginAvancado(antes: (c: ReturnType<typeof cenario>) => void) {
  const c = cenario();
  git(c.repo, "branch", "registro-externo");
  antes(c);
  const origin = avancarOrigin(c.bare);
  git(c.repo, "fetch", "-q", "origin");
  const avisos = await limpar(c.raiz, c.projeto, { id: 1, fase: "concluida" }, semVarredura);
  // O `worktree remove` da I-1 inexistente falha: só os avisos da base interessam.
  return { c, origin, avisos: avisos.filter((a) => a.startsWith("a main local")) };
}

test("limpar: a main local sem checkout avança até origin/main (CA-1)", async () => {
  const { c, origin, avisos } = await encerrarComOriginAvancado((c) =>
    git(c.repo, "checkout", "-q", "registro-externo"),
  );
  assert.deepEqual(avisos, []);
  assert.equal(git(c.repo, "rev-parse", "main"), origin);
});

test("limpar: a main local em checkout e limpa avança até origin/main (CA-2)", async () => {
  const { c, origin, avisos } = await encerrarComOriginAvancado(() => undefined);
  assert.deepEqual(avisos, []);
  assert.equal(git(c.repo, "rev-parse", "HEAD"), origin);
  assert.equal(git(c.repo, "status", "--short"), "");
});

test("limpar: com outra branch em checkout, só a main avança; a branch atual e o status ficam (CA-3)", async () => {
  const { c, origin, avisos } = await encerrarComOriginAvancado((c) => {
    git(c.repo, "checkout", "-q", "registro-externo");
    writeFileSync(join(c.repo, "solto.txt"), "não rastreado\n");
  });
  assert.deepEqual(avisos, []);
  assert.equal(git(c.repo, "rev-parse", "main"), origin);
  assert.equal(git(c.repo, "branch", "--show-current"), "registro-externo");
  assert.equal(git(c.repo, "status", "--short"), "?? solto.txt");
});

test("limpar: a main local com commit que origin/main não tem fica como está, com aviso (CA-4)", async () => {
  let local = "";
  const { c, avisos } = await encerrarComOriginAvancado((c) => {
    local = commitar(c.repo, "local.txt", "só aqui\n");
    git(c.repo, "checkout", "-q", "registro-externo");
  });
  assert.equal(git(c.repo, "rev-parse", "main"), local);
  assert.deepEqual(avisos, [
    "a main local não foi atualizada com origin/main: ela tem commits que origin/main não tem; atualize-a à mão",
  ]);
});

test("limpar: alteração local no arquivo que o merge altera deixa a main em checkout como está, com aviso (CA-5)", async () => {
  const c = cenario();
  commitar(c.repo, "novo.txt", "versão local\n");
  git(c.repo, "push", "-q", "origin", "main");
  const antes = git(c.repo, "rev-parse", "main");
  const outro = mkdtempSync(join(base, "outro-"));
  git(base, "clone", "-q", "-b", "main", c.bare, outro);
  commitar(outro, "novo.txt", "versão do PR\n");
  git(outro, "push", "-q", "origin", "main");
  git(c.repo, "fetch", "-q", "origin");
  writeFileSync(join(c.repo, "novo.txt"), "alterado à mão\n");

  const avisos = (await limpar(c.raiz, c.projeto, { id: 1, fase: "concluida" }, semVarredura)).filter((a) =>
    a.startsWith("a main local"),
  );
  assert.equal(git(c.repo, "rev-parse", "main"), antes);
  assert.equal(readFileSync(join(c.repo, "novo.txt"), "utf8"), "alterado à mão\n");
  assert.equal(avisos.length, 1);
  assert.match(
    String(avisos[0]),
    new RegExp(`^a main local não foi atualizada com origin/main, em checkout em ${c.repo}: .*novo\\.txt`, "s"),
  );
});

test("limpar: o update-ref que falha vira aviso com a saída do git, e a main fica como está", async () => {
  const { c, avisos } = await encerrarComOriginAvancado((c) => {
    git(c.repo, "checkout", "-q", "registro-externo");
    writeFileSync(join(c.repo, ".git", "refs", "heads", "main.lock"), "");
  });
  assert.equal(avisos.length, 1);
  assert.match(String(avisos[0]), /^a main local não foi atualizada com origin\/main: .*main\.lock/s);
  assert.notEqual(git(c.repo, "rev-parse", "main"), git(c.repo, "rev-parse", "origin/main"));
});

test("limpar: sem main local, não há o que atualizar nem aviso", async () => {
  const c = cenario();
  git(c.repo, "checkout", "-q", "-b", "registro-externo");
  git(c.repo, "branch", "-q", "-D", "main");
  const avisos = await limpar(c.raiz, c.projeto, { id: 1, fase: "concluida" }, semVarredura);
  assert.deepEqual(
    avisos.filter((a) => a.startsWith("a main local")),
    [],
  );
});

test("limpar só depois de encerrar a issue", async () => {
  const c = cenario();
  await assert.rejects(
    limpar(c.raiz, c.projeto, { id: 1, fase: "aprovacao_pr" }, semVarredura),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message === "a I-1 está na fase aprovacao_pr (a worktree só é removida depois de encerrar a issue)",
  );
});

test("limpeza pendente: a worktree da issue concluída que ficou no disco vira o comando que falhou, que basta", async () => {
  const c = cenario();
  const worktree = await garantirWorktree(c.raiz, c.projeto, c.issue, c.log, semVarredura);
  assert.deepEqual(limpezaPendente(c.raiz, c.projeto, { id: 1, fase: "aprovacao_pr" }), [], "ainda não encerrada");
  // A worktree no disco é o `remove` que falhou; o `prune` que falha depois de um `remove` que passou não deixa nada
  // da issue para trás.
  assert.deepEqual(limpezaPendente(c.raiz, c.projeto, { id: 1, fase: "concluida" }), [
    `git -C ${c.repo} worktree remove --force ${worktree}`,
  ]);
  for (const comando of limpezaPendente(c.raiz, c.projeto, { id: 1, fase: "concluida" })) {
    execFileSync("sh", ["-c", comando]);
  }
  assert.deepEqual(limpezaPendente(c.raiz, c.projeto, { id: 1, fase: "concluida" }), [], "rodou o comando");
  assert.doesNotMatch(execFileSync("git", ["-C", c.repo, "worktree", "list"]).toString(), /I-1/, "nada a podar");
});

test("removerWorktrees: apaga worktrees/<projeto> e faz prune; repositório, HEAD, branch e outros projetos ficam", async () => {
  const c = cenario();
  const caminho = caminhoDaWorktree(c.raiz, "demo", 1);
  mkdirSync(join(c.raiz, "worktrees", "demo"), { recursive: true });
  mkdirSync(join(c.raiz, "worktrees", "outro"), { recursive: true });
  git(c.repo, "worktree", "add", "-q", "-b", "fabriquinha/I-1", caminho);
  const head = git(c.repo, "rev-parse", "HEAD");

  assert.deepEqual(await removerWorktrees(c.raiz, { nome: "demo", repo: c.repo }), []);

  assert.equal(existsSync(join(c.raiz, "worktrees", "demo")), false);
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

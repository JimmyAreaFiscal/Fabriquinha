import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { branchDemanda, branchRodada } from "../dominio/demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { cenarioDemanda, commitarCenario as commit, gitCenario as git } from "./worktree-cenarios.ts";
import {
  atualizarWorktreeRodada,
  caminhoDaWorktreeRodada,
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
} from "./worktree-demanda.ts";
import { naFilaDoProjeto } from "./worktree.ts";

const ref = { demanda_id: "D-1", rodada_id: 1 };
const bd = branchDemanda(ref.demanda_id);
const br = branchRodada(ref.demanda_id, ref.rodada_id);
const chave = `branch.${br}.fabriquinha`;
type Cenario = ReturnType<typeof cenarioDemanda>;
const caminho = (c: Cenario, rodada_id = 1) => caminhoDaWorktreeRodada(c.raiz, c.projeto.nome, { ...ref, rodada_id });
const garantir = (c: Cenario) => garantirWorktreeRodada(c.raiz, c.projeto, ref, c.log);
const atualizar = (c: Cenario) => atualizarWorktreeRodada(c.raiz, c.projeto, ref, c.log);
const metadado = (p: string, nome = "fabriquinha-preparada") =>
  git(p, "rev-parse", "--path-format=absolute", "--git-path", nome);
async function cenario() {
  const c = cenarioDemanda();
  const demanda = await garantirWorktreeDemanda(c.raiz, c.projeto, "D-1", c.log, () => Promise.resolve());
  return { ...c, demanda };
}
async function divergente(arquivos = ["base.txt"]) {
  const c = await cenario();
  const rodada = await garantir(c);
  for (const arquivo of arquivos) {
    commit(c.demanda, arquivo, "demanda\n");
    commit(rodada, arquivo, "rodada\n");
  }
  return { ...c, rodada };
}

// Injeta somente falhas operacionais, delegando os outros comandos ao Git real.
async function comGit(c: Cenario, corpo: string, trabalho: () => Promise<void>) {
  const bin = join(c.dir, "bin");
  mkdirSync(bin);
  const executavel = join(bin, "git");
  writeFileSync(executavel, `#!/bin/sh\n${corpo}\nexec /usr/bin/git "$@"\n`);
  chmodSync(executavel, 0o755);
  const anterior = process.env.PATH;
  process.env.PATH = `${bin}:${String(anterior)}`;
  try {
    await trabalho();
  } finally {
    process.env.PATH = anterior;
  }
}

const snapshot = (c: Cenario) => ({
  refs: git(c.repo, "for-each-ref", "--format=%(refname) %(objectname)"),
  config: git(c.repo, "config", "--local", "--list"),
  worktrees: git(c.repo, "worktree", "list", "--porcelain"),
});

test("identificadores inválidos recusados antes de I/O em ambas operações", async () => {
  const c = cenarioDemanda();
  const antes = snapshot(c);
  for (const r of [
    { ...ref, demanda_id: "../D-1" },
    { ...ref, rodada_id: 0 },
    { ...ref, rodada_id: NaN },
  ]) {
    await assert.rejects(garantirWorktreeRodada(c.raiz, c.projeto, r, c.log), ErroDeRegra);
    await assert.rejects(atualizarWorktreeRodada(c.raiz, c.projeto, r, c.log), ErroDeRegra);
  }
  for (const operacao of [garantirWorktreeRodada, atualizarWorktreeRodada]) {
    await assert.rejects(operacao(c.raiz, { ...c.projeto, nome: "../loja" }, ref, c.log), ErroDeRegra);
  }
  assert.deepEqual(snapshot(c), antes);
  assert.equal(existsSync(join(c.raiz, "worktrees")), false);
});

test("demanda obrigatória: ausente, removida, movida ou checkout incorreto não é recriada", async () => {
  const vazio = cenarioDemanda();
  await assert.rejects(garantir(vazio), /obrigatória ausente/);
  for (const tipo of ["removida", "movida", "checkout", "ref-ausente"]) {
    const c = await cenario();
    if (tipo === "removida") rmSync(c.demanda, { recursive: true });
    if (tipo === "movida") git(c.repo, "worktree", "move", c.demanda, join(c.dir, "movida"));
    if (tipo === "checkout") git(c.demanda, "checkout", "-b", "humana");
    if (tipo === "ref-ausente") {
      git(c.demanda, "checkout", "--detach");
      git(c.repo, "branch", "-D", bd);
    }
    const antes = snapshot(c);
    await assert.rejects(garantir(c), ErroDeRegra);
    await assert.rejects(atualizar(c), ErroDeRegra);
    assert.deepEqual(snapshot(c), antes);
    assert.equal(existsSync(caminho(c)), false);
  }
});

test("posses ausentes, legadas, alheias e config órfã são recusadas sem alterar refs/config/conteúdo", async () => {
  for (const demanda of [false, true]) {
    for (const posse of ["", "legada 2026", "demanda:/alheia", "rodada:/alheia"]) {
      const c = await cenario();
      const rodada = await garantir(c);
      const p = demanda ? c.demanda : rodada;
      const chavePosse = demanda ? `branch.${bd}.fabriquinha` : chave;
      git(c.repo, "config", "--unset", chavePosse);
      if (posse) git(c.repo, "config", chavePosse, posse);
      writeFileSync(join(p, "preservar"), "intacto");
      const antes = snapshot(c);
      await assert.rejects(garantir(c), /não pertence/);
      await assert.rejects(atualizar(c), /não pertence/);
      assert.deepEqual(snapshot(c), antes);
      assert.equal(readFileSync(join(p, "preservar"), "utf8"), "intacto");
    }
  }
  const c = await cenario();
  git(c.repo, "config", chave, "rodada:/alheia");
  const antes = snapshot(c);
  await assert.rejects(garantir(c), /não pertence/);
  assert.deepEqual(snapshot(c), antes);
});

test("posse é literal: espaços ou newline extras não autorizam adoção", async () => {
  for (const demanda of [false, true]) {
    for (const sufixo of [" ", "\n"]) {
      const c = await cenario();
      const rodada = await garantir(c);
      const p = demanda ? c.demanda : rodada;
      git(
        c.repo,
        "config",
        demanda ? `branch.${bd}.fabriquinha` : chave,
        `${demanda ? "demanda" : "rodada"}:${p}${sufixo}`,
      );
      const antes = snapshot(c);
      await assert.rejects(garantir(c), /não pertence/);
      await assert.rejects(atualizar(c), /não pertence/);
      assert.deepEqual(snapshot(c), antes);
    }
  }
});

test("irmãs 1/2 e demanda, ignore compartilhado, ponta local atual e integração manual", async () => {
  const c = await cenario();
  const exclude = join(git(c.repo, "rev-parse", "--absolute-git-dir"), "info", "exclude");
  const ignoreAntes = readFileSync(exclude, "utf8");
  commit(c.demanda, ".gitignore", "ignorado\n");
  git(c.repo, "remote", "remove", "origin");
  const r1 = await garantir(c);
  const sha = commit(r1, "entrega.txt", "entrega");
  git(c.demanda, "merge", "--no-edit", br);
  const r2 = await garantirWorktreeRodada(c.raiz, c.projeto, { ...ref, rodada_id: 2 }, c.log);
  assert.equal(git(r2, "rev-parse", "HEAD"), sha);
  assert.equal(r1, join(dirname(c.demanda), "rodadas", "1"));
  assert.equal(r2, join(dirname(c.demanda), "rodadas", "2"));
  assert.equal(git(r1, "symbolic-ref", "HEAD"), `refs/heads/${br}`);
  assert.equal(git(r2, "symbolic-ref", "HEAD"), `refs/heads/${branchRodada(ref.demanda_id, 2)}`);
  assert.equal(git(c.demanda, "symbolic-ref", "HEAD"), `refs/heads/${bd}`);
  assert.equal(existsSync(join(c.demanda, "rodadas")), false);
  assert.equal(git(c.repo, "config", "--get", chave), `rodada:${r1}`);
  for (const p of [r1, r2, c.demanda]) {
    writeFileSync(join(p, "ignorado"), "cache");
    assert.equal(git(p, "status", "--porcelain"), "");
    assert.equal(git(p, "rev-parse", "--show-toplevel"), p);
  }
  for (const a of [r1, r2, c.demanda]) {
    for (const b of [r1, r2, c.demanda]) assert.equal(a.startsWith(`${b}/`), false);
  }
  assert.equal(await garantir(c), r1);
  assert.deepEqual(await atualizar(c), { status: "sem_alteracao" });
  assert.equal(readFileSync(exclude, "utf8"), ignoreAntes);
});

test("recriação conserva commits próprios e ref com prefixo não é adotada", async () => {
  const c = await cenario();
  git(c.repo, "branch", `${br}-2`);
  const rodada = await garantir(c);
  const sha = commit(rodada, "trabalho", "preservar");
  rmSync(rodada, { recursive: true });
  await assert.rejects(atualizar(c), /obrigatória ausente/);
  assert.equal(await garantir(c), rodada);
  assert.equal(git(rodada, "rev-parse", "HEAD"), sha);
  assert.equal(readFileSync(join(rodada, "trabalho"), "utf8"), "preservar");
  assert.equal(existsSync(metadado(rodada)), true);
  const d = await cenario();
  git(d.repo, "branch", `${br}/humana`);
  const antes = snapshot(d);
  await assert.rejects(garantir(d), /prefixo/);
  assert.deepEqual(snapshot(d), antes);
});

test("symlink, pasta ocupada, aninhamento e checkout estrangeiro são recusados", async () => {
  for (const tipo of ["symlink", "pasta", "ancestral", "descendente", "registrada", "branch", "repo"]) {
    const c = await cenario();
    const p = caminho(c);
    mkdirSync(dirname(p), { recursive: true });
    if (tipo === "symlink") symlinkSync(join(c.dir, "inexistente"), p);
    if (tipo === "pasta") mkdirSync(p);
    if (tipo === "ancestral") git(c.repo, "worktree", "add", "-b", "humana", dirname(p));
    if (tipo === "descendente" || tipo === "registrada") {
      git(c.repo, "worktree", "add", "-b", "humana", join(p, "filho"));
      if (tipo === "registrada") rmSync(p, { recursive: true });
    }
    if (tipo === "branch" || tipo === "repo") {
      await garantir(c);
      if (tipo === "branch") git(p, "checkout", "-b", "humana");
      else {
        git(c.repo, "worktree", "remove", p);
        const outro = cenarioDemanda();
        git(outro.repo, "worktree", "add", "-b", br, p);
      }
    }
    const antes = snapshot(c);
    await assert.rejects(garantir(c), ErroDeRegra);
    await assert.rejects(atualizar(c), ErroDeRegra);
    assert.deepEqual(snapshot(c), antes);
  }
});

test("fast-forward, merge de dois pais e sem alteração preservam ancestrais", async () => {
  const c = await cenario();
  const r = await garantir(c);
  const sha = commit(c.demanda, "primeiro", "demanda");
  c.projeto.preparacao = ["printf x >> ignorado"];
  git(c.repo, "config", "core.excludesFile", join(c.dir, "ignore"));
  writeFileSync(join(c.dir, "ignore"), "ignorado\n");
  assert.deepEqual(await atualizar(c), { status: "atualizada" });
  assert.equal(git(r, "rev-parse", "HEAD"), sha);
  const proprio = commit(r, "proprio", "rodada");
  const novo = commit(c.demanda, "segundo", "demanda");
  assert.deepEqual(await atualizar(c), { status: "atualizada" });
  assert.equal(git(r, "show", "-s", "--format=%P"), `${proprio} ${novo}`);
  assert.deepEqual(await atualizar(c), { status: "sem_alteracao" });
  assert.equal(readFileSync(join(r, "ignorado"), "utf8"), "xx");
  git(r, "merge-base", "--is-ancestor", sha, "HEAD");
});

test("preparação fora da fila, falha conserva merge e garantia faz retry idempotente", async () => {
  const c = await cenario();
  const r = await garantir(c);
  const sha = commit(c.demanda, "novo", "demanda");
  const iniciou = join(c.dir, "iniciou");
  const liberar = join(c.dir, "liberar");
  // Espera limitada (~30 s): se uma asserção falhar, o shell nunca fica preso até o limite de 30 min do comando.
  c.projeto.preparacao = [
    `touch '${iniciou}'; n=0; while ! test -f '${liberar}' && [ $n -lt 3000 ]; do n=$((n+1)); sleep 0.01; done; exit 7`,
  ];
  const pendente = assert.rejects(atualizar(c), /preparação.*código 7/);
  try {
    for (let i = 0; i < 1000 && !existsSync(iniciou); i++) await setTimeout(10);
    assert.equal(existsSync(iniciou), true);
    await naFilaDoProjeto(c.raiz, c.projeto.nome, () => {
      assert.equal(existsSync(metadado(r)), false);
      return Promise.resolve();
    });
  } finally {
    writeFileSync(liberar, "");
  }
  await pendente;
  assert.equal(git(r, "rev-parse", "HEAD"), sha);
  assert.equal(existsSync(metadado(r)), false);
  c.projeto.preparacao = ["printf recuperado"];
  await garantir(c);
  await garantir(c);
  assert.equal(existsSync(metadado(r)), true);
  assert.equal(readFileSync(c.log, "utf8").match(/preparação: printf recuperado/g)?.length, 1);
});

test("conflitos com espaços, acentos e newline retornam nomes exatos e abort conservador", async () => {
  const arquivos = ["ação.txt", "com espaço.txt", "linha\nnova.txt"];
  const c = await divergente(arquivos);
  const antes = git(c.rodada, "rev-parse", "HEAD");
  assert.deepEqual(await atualizar(c), { status: "conflito", arquivos });
  assert.equal(git(c.rodada, "rev-parse", "HEAD"), antes);
  assert.equal(git(c.rodada, "status", "--porcelain"), "");
  assert.equal(existsSync(metadado(c.rodada, "MERGE_HEAD")), false);
  assert.equal(existsSync(metadado(c.rodada)), true);
  for (const arquivo of arquivos) assert.equal(readFileSync(join(c.rodada, arquivo), "utf8"), "rodada\n");
});

test("sujeira tracked/untracked e todas operações pendentes são recusadas sem alteração", async () => {
  for (const tipo of [
    "tracked",
    "untracked",
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_START",
    "sequencer",
  ]) {
    const c = await cenario();
    const r = await garantir(c);
    commit(c.demanda, "novo", "novo");
    if (tipo === "tracked") writeFileSync(join(r, "base.txt"), "não perder");
    else if (tipo === "untracked") writeFileSync(join(r, "humano"), "não perder");
    else if (["rebase-merge", "rebase-apply", "sequencer"].includes(tipo)) mkdirSync(metadado(r, tipo));
    else writeFileSync(metadado(r, tipo), tipo === "CHERRY_PICK_HEAD" ? "" : git(r, "rev-parse", "HEAD") + "\n");
    const antes = git(r, "rev-parse", "HEAD");
    await assert.rejects(atualizar(c), /alterações|pendente/);
    assert.equal(git(r, "rev-parse", "HEAD"), antes);
    if (tipo === "tracked") assert.equal(readFileSync(join(r, "base.txt"), "utf8"), "não perder");
    else if (tipo === "untracked") assert.equal(readFileSync(join(r, "humano"), "utf8"), "não perder");
    else assert.equal(existsSync(metadado(r, tipo)), true);
  }
});

test("falha operacional sem conflitos não é conflito e não deixa merge pendente", async () => {
  const c = await cenario();
  const r = await garantir(c);
  commit(r, "proprio", "rodada");
  commit(c.demanda, "novo", "demanda");
  const antes = git(r, "rev-parse", "HEAD");
  const hook = join(git(r, "rev-parse", "--path-format=absolute", "--git-common-dir"), "hooks", "pre-merge-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o755);
  await assert.rejects(atualizar(c), (e: unknown) => e instanceof ErroDeRegra && e.message.includes("merge falhou"));
  assert.equal(git(r, "rev-parse", "HEAD"), antes);
  assert.equal(git(r, "status", "--porcelain"), "");
  assert.equal(existsSync(metadado(r, "MERGE_HEAD")), false);
  rmSync(hook);
  writeFileSync(metadado(r, "index.lock"), "");
  await assert.rejects(atualizar(c), /git merge --abort falhou/);
  assert.equal(existsSync(metadado(r, "index.lock")), true);
});

test("falhas de leitura, abort e verificação nunca viram conflito ou sucesso", async () => {
  for (const modo of ["leitura", "abort", "ambos", "head", "status", "pendente"]) {
    const c = await divergente();
    const original = git(c.rodada, "rev-parse", "HEAD");
    const comum = join(c.dir, "abortou");
    const corpo = `
if [ "$3" = diff ] && { [ '${modo}' = leitura ] || [ '${modo}' = ambos ]; }; then echo leitura-falhou >&2; exit 71; fi
if [ "$3 $4" = 'merge --abort' ]; then
  if [ '${modo}' = abort ] || [ '${modo}' = ambos ]; then echo abort-falhou >&2; exit 72; fi
  /usr/bin/git "$@" || exit "$?"
  touch '${comum}'
  if [ '${modo}' = pendente ]; then touch '${metadado(c.rodada, "MERGE_HEAD")}'; fi
  exit 0
fi
if test -f '${comum}'; then
  if [ '${modo}' = head ] && [ "$3 $4" = 'rev-parse HEAD' ]; then echo head-inesperado; exit 0; fi
  if [ '${modo}' = status ] && [ "$3 $4" = '--no-optional-locks status' ]; then echo status-falhou >&2; exit 73; fi
fi`;
    await comGit(c, corpo, async () => {
      await assert.rejects(atualizar(c), (e: unknown) => {
        assert.ok(e instanceof ErroDeRegra);
        assert.match(
          e.message,
          modo === "ambos" || modo === "abort"
            ? /abort-falhou/
            : modo === "leitura"
              ? /leitura-falhou/
              : modo === "head"
                ? /HEAD alterado/
                : modo === "status"
                  ? /status-falhou/
                  : /pendente/,
        );
        return true;
      });
    });
    assert.equal(git(c.rodada, "rev-parse", "HEAD"), original);
    if (modo === "leitura") {
      assert.equal(git(c.rodada, "status", "--porcelain"), "");
      assert.equal(existsSync(metadado(c.rodada, "MERGE_HEAD")), false);
    }
    if (modo === "abort" || modo === "ambos") assert.equal(existsSync(metadado(c.rodada, "MERGE_HEAD")), true);
  }
});

test("reference-transaction recusada mantém HEAD e índice alterado sem descarte automático", async () => {
  const c = await cenario();
  const r = await garantir(c);
  const antes = git(r, "rev-parse", "HEAD");
  commit(c.demanda, "novo", "demanda");
  const hook = join(
    git(r, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    "hooks",
    "reference-transaction",
  );
  writeFileSync(
    hook,
    `#!/bin/sh\nif [ "$1" = prepared ]; then\n  while read -r antigo novo ref; do\n    if [ "$ref" = 'refs/heads/${br}' ]; then exit 1; fi\n  done\nfi\nexit 0\n`,
  );
  chmodSync(hook, 0o755);
  await comGit(c, "ulimit -c 0", async () => {
    await assert.rejects(atualizar(c), /worktree com alterações/);
  });
  assert.equal(git(r, "rev-parse", "HEAD"), antes);
  assert.equal(existsSync(metadado(r, "MERGE_HEAD")), false);
  assert.equal(readFileSync(join(r, "novo"), "utf8"), "demanda");
  assert.equal(git(r, "diff", "--cached", "--name-only"), "novo");
});

test("HEAD avançado invalida marca mesmo quando post-merge deixa sujeira", async () => {
  const c = await cenario();
  const r = await garantir(c);
  const sha = commit(c.demanda, "novo", "demanda");
  const hook = join(git(r, "rev-parse", "--path-format=absolute", "--git-common-dir"), "hooks", "post-merge");
  writeFileSync(hook, "#!/bin/sh\nprintf humano > base.txt\n");
  chmodSync(hook, 0o755);
  await assert.rejects(atualizar(c), /worktree com alterações/);
  assert.equal(git(r, "rev-parse", "HEAD"), sha);
  assert.equal(existsSync(metadado(r)), false);
  assert.equal(readFileSync(join(r, "base.txt"), "utf8"), "humano");
});

test("merge recusado antes de iniciar não tenta abortar operação inexistente", async () => {
  const c = await cenario();
  const r = await garantir(c);
  commit(c.demanda, "novo", "demanda");
  const antes = git(r, "rev-parse", "HEAD");
  await comGit(c, `if [ "$3" = merge ]; then echo falha-operacional >&2; exit 75; fi`, async () => {
    await assert.rejects(atualizar(c), /merge falhou:.*falha-operacional/);
  });
  assert.equal(git(r, "rev-parse", "HEAD"), antes);
  assert.equal(git(r, "status", "--porcelain"), "");
});

test("falhas de disco da marca recebem orientação e retry sem reescrever histórico", async () => {
  const c = await cenario();
  c.projeto.preparacao = ['mkdir "$(git rev-parse --git-path fabriquinha-preparada)"'];
  await assert.rejects(garantir(c), (e: unknown) => e instanceof ErroDeRegra && e.message.includes("EISDIR"));
  const r = caminho(c);
  const antes = git(r, "rev-parse", "HEAD");
  rmSync(metadado(r), { recursive: true });
  c.projeto.preparacao = [];
  await garantir(c);
  assert.equal(git(r, "rev-parse", "HEAD"), antes);
});

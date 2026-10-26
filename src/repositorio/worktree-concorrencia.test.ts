import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { executar } from "../processo.ts";
import { cenarioDemanda, commitarCenario as commit, gitCenario as git } from "./worktree-cenarios.ts";
import {
  atualizarWorktreeRodada,
  caminhoDaWorktreeDemanda,
  garantirWorktreeDemanda,
  garantirWorktreeRodada,
} from "./worktree-demanda.ts";
import { exigirGit, naFilaDoProjeto } from "./worktree.ts";

const ref = { demanda_id: "D-1", rodada_id: 1 };
const semBase = () => Promise.resolve();
type Cenario = ReturnType<typeof cenarioDemanda>;

/** Segura a fila do projeto até `liberar()`; só devolve depois que a mutação bloqueante começou. */
async function bloquear(raiz: string, nome: string) {
  let liberar!: () => void;
  let iniciou!: () => void;
  const espera = new Promise<void>((r) => (liberar = r));
  const comecou = new Promise<void>((r) => (iniciou = r));
  const fim = naFilaDoProjeto(raiz, nome, async () => {
    iniciou();
    await espera;
  });
  await comecou;
  return { liberar, fim };
}

// Dá a qualquer trabalho pronto a chance de começar: a fila só avança por microtarefas e processos filhos.
const ceder = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const estado = (c: Cenario) => ({
  refs: git(c.repo, "for-each-ref", "--format=%(refname) %(objectname)"),
  config: git(c.repo, "config", "--local", "--list"),
  worktrees: git(c.repo, "worktree", "list", "--porcelain"),
});
const pendente = <T>(p: Promise<T>) => {
  let resolvida = false;
  void p.then(
    () => (resolvida = true),
    () => (resolvida = true),
  );
  return () => !resolvida;
};
const garantirDemanda = (c: Cenario, preparacao = c.projeto, varrer = semBase) =>
  garantirWorktreeDemanda(c.raiz, preparacao, "D-1", c.log, varrer);

test("duas garantias novas do mesmo projeto rodam em ordem, só depois de liberar a mutação retida", async () => {
  const c = cenarioDemanda();
  const antes = estado(c);
  const bloqueio = await bloquear(c.raiz, c.projeto.nome);
  const demanda = garantirDemanda(c);
  // A rodada só funciona depois da demanda: se passasse à frente, falharia por demanda ausente.
  const rodada = garantirWorktreeRodada(c.raiz, c.projeto, ref, c.log);
  const emAndamento = pendente(rodada);
  await ceder();
  assert.deepEqual(estado(c), antes);
  assert.equal(existsSync(join(c.raiz, "worktrees")), false);
  assert.equal(emAndamento(), true);
  bloqueio.liberar();
  const [pastaDemanda, pastaRodada] = await Promise.all([demanda, rodada]);
  assert.equal(pastaDemanda, caminhoDaWorktreeDemanda(c.raiz, c.projeto.nome, "D-1"));
  assert.equal(existsSync(pastaRodada), true);
  await bloqueio.fim;
});

test("atualização nova espera a mutação retida e a fila segue depois de uma falha", async () => {
  const c = cenarioDemanda();
  const demanda = await garantirDemanda(c);
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, ref, c.log);
  commit(demanda, "novo.txt", "demanda\n");
  const headAntes = git(rodada, "rev-parse", "HEAD");
  const bloqueio = await bloquear(c.raiz, c.projeto.nome);
  // Falha dentro da fila (rodada de demanda inexistente) antes da atualização que deve vencer.
  const falha = garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: "D-9", rodada_id: 1 }, c.log);
  const falhou = assert.rejects(falha, ErroDeRegra);
  const atualizacao = atualizarWorktreeRodada(c.raiz, c.projeto, ref, c.log);
  await ceder();
  assert.equal(git(rodada, "rev-parse", "HEAD"), headAntes);
  assert.equal(existsSync(join(rodada, "novo.txt")), false);
  bloqueio.liberar();
  await falhou;
  assert.deepEqual(await atualizacao, { status: "atualizada" });
  assert.equal(existsSync(join(rodada, "novo.txt")), true);
});

test("mutação retida que falha não trava a fila", async () => {
  const c = cenarioDemanda();
  const falha = naFilaDoProjeto(c.raiz, c.projeto.nome, () => Promise.reject(new Error("boom")));
  const seguinte = garantirDemanda(c);
  await assert.rejects(falha, /boom/);
  assert.equal(existsSync(await seguinte), true);
});

test("outro projeto completa mutação enquanto o primeiro segue bloqueado", async () => {
  const c = cenarioDemanda();
  const outro = cenarioDemanda();
  const projetoOutro = { ...outro.projeto, nome: "outra" };
  const bloqueio = await bloquear(c.raiz, c.projeto.nome);
  const pasta = await garantirWorktreeDemanda(c.raiz, projetoOutro, "D-1", c.log, semBase);
  assert.equal(existsSync(pasta), true);
  const retido = garantirDemanda(c);
  const emAndamento = pendente(retido);
  await ceder();
  assert.equal(emAndamento(), true);
  bloqueio.liberar();
  await retido;
});

test("raiz equivalente usa a mesma fila do projeto", async () => {
  const c = cenarioDemanda();
  for (const raiz of [`${c.raiz}/`, `${c.raiz}/./`, `${c.raiz}/x/..`]) {
    const bloqueio = await bloquear(c.raiz, c.projeto.nome);
    let rodou = false;
    const vez = naFilaDoProjeto(raiz, c.projeto.nome, () => Promise.resolve((rodou = true)));
    await ceder();
    assert.equal(rodou, false, raiz);
    bloqueio.liberar();
    await vez;
  }
});

test("processo de agente na worktree provisionada começa e termina com a fila retida", async () => {
  const c = cenarioDemanda();
  const demanda = await garantirDemanda(c);
  const bloqueio = await bloquear(c.raiz, c.projeto.nome);
  const retido = garantirWorktreeRodada(c.raiz, c.projeto, ref, c.log);
  const emAndamento = pendente(retido);
  const r = await executar("/bin/sh", ["-c", "echo agente > agente.txt"], { cwd: demanda });
  assert.equal(r.codigo, 0);
  assert.equal(await readFile(join(demanda, "agente.txt"), "utf8"), "agente\n");
  assert.equal(emAndamento(), true);
  bloqueio.liberar();
  await retido;
});

/** Preparação que avisa que começou e só termina quando o teste libera; fifos são barreiras reais. */
function preparacaoComBarreira(c: Cenario) {
  const inicio = join(c.dir, "inicio.fifo");
  const libera = join(c.dir, "libera.fifo");
  execFileSync("mkfifo", [inicio, libera]);
  return {
    projeto: { ...c.projeto, preparacao: [`echo ok > ${inicio}; read _ < ${libera}`] },
    comecou: () => readFile(inicio, "utf8"),
    liberar: () => writeFile(libera, "x\n"),
  };
}
const mutacaoLivre = (c: Cenario) =>
  naFilaDoProjeto(c.raiz, c.projeto.nome, () => exigirGit(c.repo, "config", "teste.livre", "sim"));

test("preparação da demanda não ocupa a fila", async () => {
  const c = cenarioDemanda();
  const barreira = preparacaoComBarreira(c);
  const garantia = garantirDemanda(c, barreira.projeto);
  await barreira.comecou();
  await mutacaoLivre(c);
  assert.equal(git(c.repo, "config", "teste.livre"), "sim");
  await barreira.liberar();
  await garantia;
});

test("preparação da rodada não ocupa a fila", async () => {
  const c = cenarioDemanda();
  await garantirDemanda(c);
  const barreira = preparacaoComBarreira(c);
  const garantia = garantirWorktreeRodada(c.raiz, barreira.projeto, ref, c.log);
  await barreira.comecou();
  await mutacaoLivre(c);
  await barreira.liberar();
  await garantia;
});

test("preparação após atualização por merge não ocupa a fila", async () => {
  const c = cenarioDemanda();
  const demanda = await garantirDemanda(c);
  await garantirWorktreeRodada(c.raiz, c.projeto, ref, c.log);
  commit(demanda, "novo.txt", "demanda\n");
  const barreira = preparacaoComBarreira(c);
  const atualizacao = atualizarWorktreeRodada(c.raiz, barreira.projeto, ref, c.log);
  await barreira.comecou();
  await mutacaoLivre(c);
  await barreira.liberar();
  assert.deepEqual(await atualizacao, { status: "atualizada" });
});

test("varrerBase da demanda roda fora da fila e não impede outra mutação", async () => {
  const c = cenarioDemanda();
  let iniciou!: () => void;
  let liberar!: () => void;
  const comecou = new Promise<void>((r) => (iniciou = r));
  const espera = new Promise<void>((r) => (liberar = r));
  const varrer = async () => {
    // Entrar na fila por conta própria só é possível se ela não estiver retida pela garantia.
    await naFilaDoProjeto(c.raiz, c.projeto.nome, () => Promise.resolve());
    iniciou();
    await espera;
  };
  const garantia = garantirDemanda(c, c.projeto, varrer);
  await comecou;
  await mutacaoLivre(c);
  assert.equal(git(c.repo, "config", "teste.livre"), "sim");
  liberar();
  await garantia;
});

test("merge e abort do conflito ficam na mesma seção serializada", async () => {
  const c = cenarioDemanda();
  const demanda = await garantirDemanda(c);
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, ref, c.log);
  commit(demanda, "base.txt", "demanda\n");
  commit(rodada, "base.txt", "rodada\n");
  const gitDir = git(rodada, "rev-parse", "--path-format=absolute", "--git-dir");
  const observacoes: { merge: boolean; sujo: string }[] = [];
  const sonda = () =>
    naFilaDoProjeto(c.raiz, c.projeto.nome, () => {
      observacoes.push({ merge: existsSync(join(gitDir, "MERGE_HEAD")), sujo: git(rodada, "status", "--porcelain") });
      return Promise.resolve();
    });
  const atualizacao = atualizarWorktreeRodada(c.raiz, c.projeto, ref, c.log);
  await Promise.all([sonda(), atualizacao]);
  await sonda();
  assert.deepEqual(await atualizacao, { status: "conflito", arquivos: ["base.txt"] });
  assert.deepEqual(observacoes, [
    { merge: false, sujo: "" },
    { merge: false, sujo: "" },
  ]);
});

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { cenarioDemanda, commitarCenario, gitCenario as git } from "./worktree-cenarios.ts";
import { migrarGitEmVoo } from "./migracao_git_demanda.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "./worktree-demanda.ts";
import { caminhoDaWorktree } from "./worktree.ts";

const marca = (repo: string, b: string) => git(repo, "config", "--default", "", "--get", `branch.${b}.fabriquinha`);

function legada() {
  const c = cenarioDemanda();
  const pasta = caminhoDaWorktree(c.raiz, "loja", 7);
  git(c.repo, "fetch", "-q", "origin");
  git(c.repo, "worktree", "add", "-q", "-b", "fabriquinha/I-7", pasta, "origin/integracao");
  const base = git(c.repo, "rev-parse", "origin/integracao");
  const topo = commitarCenario(pasta, "feito.txt", "x");
  return { c, pasta, base, topo };
}

test("branch da rodada no HEAD, demanda na base, worktree limpa removida, segunda chamada sem efeito", async () => {
  const { c, pasta, base, topo } = legada();
  const emVoo = [{ issue: "I-7" }, { issue: "I-8" }]; // I-8 sem branch: nada a migrar
  const [r, ...resto] = await migrarGitEmVoo(c.raiz, c.projeto, emVoo);
  assert.deepEqual(r, { issue: "I-7", criouRodada: true, moveuDemanda: true, removeuWorktree: true });
  assert.equal(resto.length, 0);
  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-7-1"), topo);
  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-7"), base);
  const rodada = caminhoDaWorktreeRodada(c.raiz, "loja", { demanda_id: "I-7", rodada_id: 1 });
  assert.equal(marca(c.repo, "fabriquinha/I-7-1"), `rodada:${rodada}`);
  assert.equal(marca(c.repo, "fabriquinha/I-7"), `demanda:${caminhoDaWorktreeDemanda(c.raiz, "loja", "I-7")}`);
  assert.equal(existsSync(pasta), false);
  assert.equal(git(c.bare, "branch", "--list", "fabriquinha/*"), "");

  const [de_novo] = await migrarGitEmVoo(c.raiz, c.projeto, emVoo);
  assert.deepEqual(de_novo, { issue: "I-7", criouRodada: false, moveuDemanda: false, removeuWorktree: false });
  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-7-1"), topo);
});

test("worktree apagada à mão: usa a branch e conclui", async () => {
  const { c, pasta, base, topo } = legada();
  git(pasta, "checkout", "-q", "--detach");
  git(c.repo, "worktree", "remove", "--force", pasta);
  const [r] = await migrarGitEmVoo(c.raiz, c.projeto, [{ issue: "I-7" }]);
  assert.deepEqual(r, { issue: "I-7", criouRodada: true, moveuDemanda: true, removeuWorktree: false });
  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-7-1"), topo);
  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-7"), base);
});

test("worktree suja: recusa citando o caminho e nada muda", async () => {
  const { c, pasta, topo } = legada();
  writeFileSync(join(pasta, "solto.txt"), "sujo");
  await assert.rejects(migrarGitEmVoo(c.raiz, c.projeto, [{ issue: "I-7" }]), (e: unknown) => {
    assert.ok(e instanceof ErroDeRegra);
    assert.match(e.message, new RegExp(pasta));
    return true;
  });
  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-7"), topo);
  assert.equal(git(c.repo, "branch", "--list", "fabriquinha/I-7-1"), "");
  assert.ok(existsSync(pasta));
});

test("branch da rodada de outro dono é recusada", async () => {
  const { c } = legada();
  git(c.repo, "branch", "fabriquinha/I-7-1");
  await assert.rejects(migrarGitEmVoo(c.raiz, c.projeto, [{ issue: "I-7" }]), /não pertence à rodada 1 de I-7/);
});

test("com PR aberto a branch da issue fica na cabeça, só troca de dono", async () => {
  const { c, topo } = legada();
  const [r] = await migrarGitEmVoo(c.raiz, c.projeto, [{ issue: "I-7", pr: true }]);
  assert.deepEqual(r, { issue: "I-7", criouRodada: true, moveuDemanda: false, removeuWorktree: true });
  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-7"), topo);
  assert.equal(git(c.repo, "rev-parse", "fabriquinha/I-7-1"), topo);
  assert.equal(marca(c.repo, "fabriquinha/I-7"), `demanda:${caminhoDaWorktreeDemanda(c.raiz, "loja", "I-7")}`);
});

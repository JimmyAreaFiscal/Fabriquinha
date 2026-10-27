import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { branchDemanda, branchRodada } from "../dominio/demanda.ts";
import { limparDemanda, pendenciasDeLimpeza, sobrasDaDemanda } from "./limpeza_demanda.ts";
import { cenarioDemanda, gitCenario as git } from "./worktree-cenarios.ts";
import { caminhoDaWorktreeRodada, garantirWorktreeDemanda, garantirWorktreeRodada } from "./worktree-demanda.ts";

const ref = { demanda_id: "D-1", rodada_id: 1 };
const ag = { demanda: { id: "D-1" }, rodadas: [{ rodada_id: 1 }, { rodada_id: 2 }] } as never;
const bd = branchDemanda("D-1");
const br = branchRodada("D-1", 1);

async function cenario() {
  const c = cenarioDemanda();
  const demanda = await garantirWorktreeDemanda(c.raiz, c.projeto, "D-1", c.log, () => Promise.resolve());
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, ref, c.log);
  git(c.repo, "branch", "alheia", "integracao");
  git(c.repo, "config", "branch.fabriquinha/D-1-2.fabriquinha", "rodada:fantasma");
  for (const b of [bd, br, "alheia", "integracao"]) git(c.repo, "push", "-q", "origin", `refs/heads/${b}`);
  const remotas = () => git(c.bare, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n");
  return { ...c, demanda, rodada, remotas };
}

test("pendências só da demanda e das rodadas, nunca a base nem branch alheia", async () => {
  const c = await cenario();
  const pendentes = await pendenciasDeLimpeza(c.raiz, c.projeto, ag);
  assert.deepEqual(pendentes.toSorted(), [
    `branch_local:${bd}`,
    `branch_local:${br}`,
    `branch_remota:${bd}`,
    `branch_remota:${br}`,
    `worktree:${c.demanda}`,
    `worktree:${c.rodada}`,
  ]);
});

test("limpa worktrees e branches locais e remotas, preservando base e branch alheia (CA-11)", async () => {
  const c = await cenario();
  const pendentes = await pendenciasDeLimpeza(c.raiz, c.projeto, ag);
  const r = await limparDemanda(c.raiz, c.projeto, pendentes);
  assert.deepEqual(r.pendentes, []);
  assert.equal(r.removidos.length, 6);
  assert.deepEqual(await sobrasDaDemanda(c.projeto, r.removidos), []);
  assert.deepEqual((await pendenciasDeLimpeza(c.raiz, c.projeto, ag)).length, 0);
  assert.deepEqual(c.remotas().toSorted(), ["alheia", "integracao"]);
  assert.match(
    git(c.repo, "branch", "--list", "alheia", "integracao"),
    /alheia[\s\S]*integracao|integracao[\s\S]*alheia/,
  );
  assert.equal(existsSync(c.demanda), false);
});

test("item que falha vira pendência e a reabertura repete só o que falta (CA-12)", async () => {
  const c = await cenario();
  git(c.repo, "worktree", "lock", c.rodada);
  const pendentes = await pendenciasDeLimpeza(c.raiz, c.projeto, ag);
  const r = await limparDemanda(c.raiz, c.projeto, pendentes);
  assert.deepEqual(r.pendentes.toSorted(), [`branch_local:${br}`, `worktree:${c.rodada}`]);
  assert.deepEqual(await sobrasDaDemanda(c.projeto, r.pendentes), [`worktree:${c.rodada}`, `branch_local:${br}`]);
  git(c.repo, "worktree", "unlock", c.rodada);
  assert.deepEqual(await pendenciasDeLimpeza(c.raiz, c.projeto, ag), [`worktree:${c.rodada}`, `branch_local:${br}`]);
  const de_novo = await limparDemanda(c.raiz, c.projeto, r.pendentes);
  assert.deepEqual(de_novo.pendentes, []);
  assert.equal(existsSync(caminhoDaWorktreeRodada(c.raiz, c.projeto.nome, ref)), false);
});

test("remota já ausente conta como feita; item desconhecido ou erro do git ficam pendentes", async () => {
  const c = await cenario();
  git(c.repo, "push", "-q", "origin", "--delete", bd);
  const sem = join(c.dir, "sem-origin");
  mkdirSync(sem);
  git(sem, "init", "-q");
  const r = await limparDemanda(c.raiz, c.projeto, [`branch_remota:${bd}`, "outro:x"]);
  assert.deepEqual(r, { removidos: [`branch_remota:${bd}`], pendentes: ["outro:x"] });
  const erro = await limparDemanda(c.raiz, { ...c.projeto, repo: sem }, ["branch_remota:x"]);
  assert.deepEqual(erro.pendentes, ["branch_remota:x"]);
});

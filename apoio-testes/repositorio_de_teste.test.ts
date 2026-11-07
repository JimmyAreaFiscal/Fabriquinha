import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { AMBIENTE_GIT_ISOLADO, commitarArquivo, criarRepositorioDeTeste, rodarGit } from "./repositorio_de_teste.ts";

test("cria o clone com a branch base publicada no origin, sem tocar no ambiente do processo", () => {
  const antes = process.env.GIT_CONFIG_GLOBAL;
  const r = criarRepositorioDeTeste(["npm ci"], "main");
  try {
    assert.equal(process.env.GIT_CONFIG_GLOBAL, antes);
    assert.equal(rodarGit(r.repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(rodarGit(r.bare, "rev-parse", "main"), rodarGit(r.repo, "rev-parse", "HEAD"));
    assert.deepEqual(r.projeto, {
      nome: "loja",
      raiz_git: r.repo,
      branch_base: "main",
      hospedagem: "github",
      preparacao: [{ ordem: 1, comando: "npm ci" }],
    });
    assert.equal(r.log, `${r.raiz}/log`);
  } finally {
    r.fechar();
  }
  assert.equal(existsSync(r.dir), false);
});

test("o commit usa a identidade de teste, e a worktree a herda do clone", () => {
  const r = criarRepositorioDeTeste();
  try {
    const sha = commitarArquivo(r.repo, "a.txt", "a\n");
    assert.equal(rodarGit(r.repo, "rev-parse", "HEAD"), sha);
    assert.equal(rodarGit(r.repo, "log", "-1", "--format=%an <%ae>"), "Teste <teste@exemplo.com>");
    // código de produção roda o git sem `-c`: a identidade vem do config do clone, que a worktree herda
    rodarGit(r.repo, "worktree", "add", "-q", "-b", "outra", `${r.dir}/wt`);
    execFileSync("/usr/bin/git", ["commit", "-q", "--allow-empty", "-m", "x"], {
      cwd: `${r.dir}/wt`,
      env: { ...process.env, ...AMBIENTE_GIT_ISOLADO },
    });
    assert.equal(rodarGit(`${r.dir}/wt`, "log", "-1", "--format=%an"), "Teste");
  } finally {
    r.fechar();
  }
});

test("cada repositório é independente do outro", () => {
  const um = criarRepositorioDeTeste();
  const outro = criarRepositorioDeTeste();
  try {
    assert.notEqual(um.dir, outro.dir);
    commitarArquivo(um.repo, "so-no-um.txt", "x");
    assert.equal(existsSync(`${outro.repo}/so-no-um.txt`), false);
  } finally {
    um.fechar();
    outro.fechar();
  }
});

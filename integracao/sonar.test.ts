// Teste de integração do coletor do SonarQube contra o servidor local e o scanner em Docker de verdade (F3 §10).
// Fora da suíte padrão, porque depende do Docker e do servidor no ar: `npm run integracao`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Ator } from "../src/dominio/agregado.ts";
import { iniciarExecucao } from "../src/dominio/execucao.ts";
import { coletarSonar } from "../src/evidencias/sonar.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { agregado, comIssue, registrarIssue } from "../src/persistencia/issues.ts";
import { registrarProjeto } from "../src/persistencia/projetos.ts";
import { garantirWorktree } from "../src/repositorio/worktree.ts";

const CHAVE = "fabriquinha-integracao-sonar";
// Docker Desktop só compartilha $HOME com os contêineres.
mkdirSync(join(homedir(), ".cache"), { recursive: true });
const dir = mkdtempSync(join(homedir(), ".cache", "fabriquinha-integracao-"));
const raiz = join(dir, "raiz");
const banco = abrir(raiz);

// git sem a configuração do usuário da máquina.
writeFileSync(join(dir, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(dir, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

after(async () => {
  banco.close();
  rmSync(dir, { recursive: true, force: true });
  // Remove o projeto que a análise criou no servidor.
  const host = String(process.env.SONAR_HOST_URL).replace(/\/+$/, "");
  const resposta = await fetch(`${host}/api/projects/delete?project=${CHAVE}`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${String(process.env.SONAR_TOKEN)}:`).toString("base64")}` },
  });
  assert.equal(resposta.status, 204);
});

const fabriquinha: Ator = { tipo: "fabriquinha" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
// Variável local não usada (javascript:S1481, do perfil padrão): uma issue certa.
const COM_ISSUE = "export function soma(a, b) {\n  const naoUsada = 1;\n  return a + b;\n}\n";
const LIMPO = "export function soma(a, b) {\n  return a + b;\n}\n";

test("o SonarQube local acusa a issue do arquivo alterado, ignora a do intocado e aprova depois da correção", async () => {
  // Repositório com `origin` bare e, versionado, um sonar-project.properties que tentaria zerar a análise.
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  git(dir, "init", "-q", "--bare", bare);
  git(dir, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  writeFileSync(join(repo, "intocado.js"), COM_ISSUE);
  writeFileSync(join(repo, "alterado.js"), LIMPO);
  writeFileSync(join(repo, "sonar-project.properties"), "sonar.exclusions=**\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  git(repo, "push", "-q", "origin", "main");

  const projeto = {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    preparacao: [],
    testes: ["true"],
    sonar: { projectKey: CHAVE },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  };
  registrarProjeto(banco, projeto);
  registrarIssue(banco, { projeto: "loja" }, { tipo: "auditor" });
  // ponytail: atalho até o desenvolvimento; as transições até lá são de outros tickets e têm os próprios testes.
  banco.exec(
    "UPDATE issue SET fase = 'desenvolvimento', titulo = 'Soma', tipo = 'problema'; " +
      "UPDATE ticket SET etapa = 'desenvolvimento'",
  );
  comIssue(banco, 1, "iniciarExecucao", fabriquinha, (ag, ctx) =>
    iniciarExecucao(
      ag,
      { ticket: 1, modo: "autonomo", sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" },
      fabriquinha,
      ctx,
    ),
  );

  // Worktree vinculada, como no uso real: o .git dela aponta para o .git do repositório, que o scanner também monta.
  mkdirSync(join(raiz, "execucoes", "E-1"), { recursive: true });
  const issue = agregado(banco, 1)?.issue;
  assert.ok(issue);
  const worktree = await garantirWorktree(raiz, projeto, issue, join(raiz, "execucoes", "E-1", "log"), () =>
    Promise.resolve(),
  );
  writeFileSync(join(worktree, "alterado.js"), COM_ISSUE);
  writeFileSync(join(worktree, "novo.js"), LIMPO);

  const reprovada = (await coletarSonar(banco, 1)).evidencias.find((e) => e.tipo === "relatorio_sonar");
  assert.equal(reprovada?.aprovada, false);
  assert.equal(reprovada.dados.projectKey, CHAVE);
  assert.deepEqual(reprovada.dados.arquivosAnalisados, ["alterado.js", "novo.js"]);
  assert.deepEqual(
    (reprovada.dados.issues as { arquivo: string; linha: number; regra: string }[]).map((i) => [
      i.arquivo,
      i.linha,
      i.regra,
    ]),
    [["alterado.js", 2, "javascript:S1481"]],
  );

  writeFileSync(join(worktree, "alterado.js"), LIMPO.replace("a + b", "b + a"));
  const aprovada = (await coletarSonar(banco, 1)).evidencias.find((e) => e.tipo === "relatorio_sonar");
  assert.equal(aprovada?.aprovada, true);
  assert.deepEqual(aprovada.dados.issues, []);
  assert.notEqual(aprovada.dados.ceTaskId, reprovada.dados.ceTaskId);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { migrar } from "../persistencia/banco.ts";
import { commitDoTicketDemanda } from "../persistencia/commits_demanda.ts";
import { MIGRACOES } from "../persistencia/migracoes.ts";
import { acharCommitTicketDemanda, commitarTicketDemanda } from "./commit_ticket_demanda.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-commit-demanda-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
const escreve = (cwd: string, arquivo: string, texto: string) => {
  writeFileSync(join(cwd, arquivo), texto);
};
const ref = (n: number) => ({ demanda_id: "I-1", ticket_id: n });

let n = 0;
function cenario() {
  const worktree = join(base, `w${String(++n)}`);
  execFileSync("git", ["init", "-q", "-b", "main", worktree]);
  escreve(worktree, "a.txt", "a\nb\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "inicial");
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrar(banco, MIGRACOES);
  const t = "'2026-01-01T00:00:00.000Z'";
  banco.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
    VALUES ('p', '${worktree}', 'main', 'github', '["t"]', 'k', '[{"nome":"f","comando":"true","descricao":"d"}]')`);
  banco.exec(
    `INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'execucao', ${t}, 'f', 's', 1, 'fabriquinha/I-1')`,
  );
  for (const id of [1, 2])
    banco.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('I-1', ${String(id)}, 'implementar', 'aberto', ${t})`);
  return { worktree, banco };
}

test("um commit com a marca, arquivos e linhas iguais ao git show --stat, e repetição não duplica", async () => {
  const { worktree, banco } = cenario();
  assert.equal(await acharCommitTicketDemanda(worktree, ref(1)), undefined);
  escreve(worktree, "a.txt", "a\nb\nc\n");
  escreve(worktree, "novo.txt", "x\ny\n");
  const feito = await commitarTicketDemanda(banco, ref(1), { worktree, tipo: "feat", titulo: "Cache" });
  assert.equal(feito.mensagem, "feat: Cache [I-1.T1]");
  assert.deepEqual(
    feito.arquivos.map((a) => [a.caminho, a.status, a.adicionadas, a.removidas]),
    [
      ["a.txt", "M", 1, 0],
      ["novo.txt", "A", 2, 0],
    ],
  );
  assert.match(git(worktree, "show", "--stat", "--format=", "HEAD"), /a\.txt\s+\|\s+1 \+\n.*novo\.txt\s+\|\s+2 \+\+/);
  assert.deepEqual(commitDoTicketDemanda(banco, "I-1", 1), feito);
  assert.deepEqual(await acharCommitTicketDemanda(worktree, ref(1)), feito);
  assert.equal(await acharCommitTicketDemanda(worktree, ref(2)), undefined);

  // queda antes da gravação: o commit existe, o registro não
  banco.exec("DELETE FROM arquivo_commit_demanda; DELETE FROM commit_ticket_demanda");
  const de_novo = await commitarTicketDemanda(banco, ref(1), { worktree, tipo: "feat", titulo: "Cache" });
  assert.equal(de_novo.sha, feito.sha);
  assert.equal(git(worktree, "rev-list", "--count", "HEAD").trim(), "2");
  assert.deepEqual(commitDoTicketDemanda(banco, "I-1", 1), feito);
});

test("sem alteração o commit sai vazio", async () => {
  const { worktree, banco } = cenario();
  const c = await commitarTicketDemanda(banco, ref(1), { worktree, tipo: "fix", titulo: "Nada" });
  assert.deepEqual(c.arquivos, []);
  assert.equal(c.mensagem, "fix: Nada [I-1.T1]");
});

test("merge do resolver_conflito: arquivos contra o primeiro pai", async () => {
  const { worktree, banco } = cenario();
  git(worktree, "checkout", "-qb", "outra");
  escreve(worktree, "o.txt", "o\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "outra");
  git(worktree, "checkout", "-q", "main");
  escreve(worktree, "m.txt", "m\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "main");
  git(worktree, "merge", "--no-commit", "--no-ff", "outra");
  const c = await commitarTicketDemanda(banco, ref(2), { worktree, tipo: "fix", titulo: "Conflito" });
  assert.equal(git(worktree, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ").length, 3);
  assert.deepEqual(
    c.arquivos.map((a) => a.caminho),
    ["o.txt"],
  );
});

test("o commit do ticket grava o retrabalho sobre as linhas do ticket anterior", async () => {
  const { worktree, banco } = cenario();
  escreve(worktree, "a.txt", "a\nb\nc\nd\ne\n");
  await commitarTicketDemanda(banco, ref(1), { worktree, tipo: "feat", titulo: "Um" });
  escreve(worktree, "a.txt", "a\nb\nX\nY\nZ\n");
  await commitarTicketDemanda(banco, ref(2), { worktree, tipo: "feat", titulo: "Dois" });
  assert.deepEqual(
    banco
      .prepare(
        "SELECT ticket_id AS alterador_ticket_id, ticket_origem_id AS origem_ticket_id, linhas FROM retrabalho_demanda",
      )
      .all()
      .map((l) => ({ ...l })),
    [{ alterador_ticket_id: 2, origem_ticket_id: 1, linhas: 3 }],
  );
});

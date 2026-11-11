import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { ErroDeReprovacao } from "../../../compartilhado/nucleo/erros.ts";
import { migrar } from "../../../compartilhado/armazenamento/banco.ts";
import { commitDoTicketDemanda } from "../../../sdlc/armazenamento/commits_demanda.ts";
import { MIGRACOES } from "../../../compartilhado/armazenamento/migracoes/migracoes.ts";
import type { ComandoNoAmbiente } from "../../../sandbox/infra/ambiente.ts";
import { AmbienteHostLocal } from "../../../sandbox/infra/host_local/ambiente_host_local.ts";
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
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '${worktree}', 'main', 'github', 'k')`);
  banco.exec(
    `INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', ${t}, 'f', 's', 1, 'fabriquinha/I-1')`,
  );
  for (const id of [1, 2])
    banco.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', ${String(id)}, 'implementar', 'aberto', ${t})`);
  return { worktree, banco };
}

/** O host local registrando cada comando que recebe, para provar que o git passou pelo Ambiente. */
class AmbienteQueRegistra extends AmbienteHostLocal {
  readonly argumentosRecebidos: string[][] = [];
  override executar(comando: ComandoNoAmbiente) {
    this.argumentosRecebidos.push(comando.argumentos);
    return super.executar(comando);
  }
}

test("um commit com a marca, arquivos e linhas iguais ao git show --stat, e repetição não duplica", async () => {
  const { worktree, banco } = cenario();
  const ambiente = new AmbienteQueRegistra();
  assert.equal(await acharCommitTicketDemanda(ambiente, worktree, ref(1)), undefined);
  escreve(worktree, "a.txt", "a\nb\nc\n");
  escreve(worktree, "novo.txt", "x\ny\n");
  const feito = await commitarTicketDemanda(banco, ref(1), {
    ambiente,
    worktree,
    tipo: "feat",
    titulo: "Cache",
    etapa: "implementar",
  });
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
  assert.deepEqual(await acharCommitTicketDemanda(ambiente, worktree, ref(1)), feito);
  assert.equal(await acharCommitTicketDemanda(ambiente, worktree, ref(2)), undefined);
  const subcomandos = ambiente.argumentosRecebidos.map((a) => a.slice(2).find((x) => !x.startsWith("-")));
  for (const subcomando of ["add", "diff", "rev-parse", "show", "log"]) assert.ok(subcomandos.includes(subcomando));

  // queda antes da gravação: o commit existe, o registro não
  banco.exec("DELETE FROM arquivo_commit_demanda; DELETE FROM commit_ticket_demanda");
  const de_novo = await commitarTicketDemanda(banco, ref(1), {
    ambiente: new AmbienteHostLocal(),
    worktree,
    tipo: "feat",
    titulo: "Cache",
    etapa: "implementar",
  });
  assert.equal(de_novo.sha, feito.sha);
  assert.equal(git(worktree, "rev-list", "--count", "HEAD").trim(), "2");
  assert.deepEqual(commitDoTicketDemanda(banco, "I-1", 1), feito);
});

test("implementar sem alteração é rejeitado, sem commit", async () => {
  const { worktree, banco } = cenario();
  await assert.rejects(
    commitarTicketDemanda(banco, ref(1), {
      ambiente: new AmbienteHostLocal(),
      worktree,
      tipo: "fix",
      titulo: "Nada",
      etapa: "implementar",
    }),
    (erro) =>
      erro instanceof ErroDeReprovacao && erro.message.startsWith("o ticket I-1.T1 terminou sem alteração na worktree"),
  );
  assert.equal(git(worktree, "rev-list", "--count", "HEAD").trim(), "1");
});

test("resolver_conflito sem alteração commita o merge vazio com dois pais", async () => {
  const { worktree, banco } = cenario();
  git(worktree, "checkout", "-qb", "outra");
  git(worktree, "commit", "-q", "--allow-empty", "-m", "outra");
  git(worktree, "checkout", "-q", "main");
  git(worktree, "merge", "--no-ff", "--no-commit", "outra");
  const c = await commitarTicketDemanda(banco, ref(2), {
    ambiente: new AmbienteHostLocal(),
    worktree,
    tipo: "fix",
    titulo: "Nada",
    etapa: "resolver_conflito",
  });
  assert.deepEqual(c.arquivos, []);
  assert.equal(c.mensagem, "fix: Nada [I-1.T2]");
  assert.equal(git(worktree, "log", "-1", "--format=%P").trim().split(" ").length, 2);
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
  const c = await commitarTicketDemanda(banco, ref(2), {
    ambiente: new AmbienteHostLocal(),
    worktree,
    tipo: "fix",
    titulo: "Conflito",
    etapa: "resolver_conflito",
  });
  assert.equal(git(worktree, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ").length, 3);
  assert.deepEqual(
    c.arquivos.map((a) => a.caminho),
    ["o.txt"],
  );
});

test("o commit do ticket grava os commits posteriores sobre as linhas do ticket anterior", async () => {
  const { worktree, banco } = cenario();
  escreve(worktree, "a.txt", "a\nb\nc\nd\ne\n");
  await commitarTicketDemanda(banco, ref(1), {
    ambiente: new AmbienteHostLocal(),
    worktree,
    tipo: "feat",
    titulo: "Um",
    etapa: "implementar",
  });
  escreve(worktree, "a.txt", "a\nb\nX\nY\nZ\n");
  await commitarTicketDemanda(banco, ref(2), {
    ambiente: new AmbienteHostLocal(),
    worktree,
    tipo: "feat",
    titulo: "Dois",
    etapa: "implementar",
  });
  assert.deepEqual(
    banco
      .prepare(
        "SELECT ticket_id AS alterador_ticket_id, ticket_origem_id AS origem_ticket_id, linhas FROM commit_humano_posterior",
      )
      .all()
      .map((l) => ({ ...l })),
    [{ alterador_ticket_id: 2, origem_ticket_id: 1, linhas: 3 }],
  );
});

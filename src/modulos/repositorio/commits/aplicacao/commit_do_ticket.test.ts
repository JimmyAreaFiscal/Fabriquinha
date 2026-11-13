import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { ErroDeReprovacao } from "../../../../shared/nucleo/erros.ts";
import { LIMITE_COMANDO_MS } from "../../../../shared/nucleo/primitivos.ts";
import { commitDoTicketDemanda } from "../armazenamento/commits_demanda.ts";
import { type ComandoNoAmbiente } from "../../../ambiente/publico.ts";
import { AmbienteHostLocal } from "../../../../../apoio-testes/falsos/ambiente_falso.ts";
import { acharCommitComMarca, commitarTicket, type PedidoDeCommit } from "./commit_do_ticket.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";

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
const marca = (n: number) => `[I-1.T${String(n)}]`;
/** O pedido do ticket `n` com a mensagem `<tipo>: <título> [I-1.Tn]`. */
const pedido = (n: number, cabecalho: string, extra: Partial<PedidoDeCommit> = {}): PedidoDeCommit => ({
  demanda_id: "I-1",
  ticket_id: n,
  marca: marca(n),
  mensagem: `${cabecalho} ${marca(n)}`,
  ...extra,
});

let n = 0;
function cenario() {
  const worktree = join(base, `w${String(++n)}`);
  execFileSync("git", ["init", "-q", "-b", "main", worktree]);
  escreve(worktree, "a.txt", "a\nb\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "inicial");
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrarBancoDaFabriquinha(banco);
  const t = "'2026-01-01T00:00:00.000Z'";
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '${worktree}', 'main', 'github', 'k')`);
  banco.exec(
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', ${t}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda)`,
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
  assert.equal(await acharCommitComMarca(ambiente, worktree, marca(1)), undefined);
  escreve(worktree, "a.txt", "a\nb\nc\n");
  escreve(worktree, "novo.txt", "x\ny\n");
  const feito = await commitarTicket(
    banco,
    ambiente,
    worktree,
    { nome: "p", raiz_git: worktree },
    pedido(1, "feat: Cache"),
    LIMITE_COMANDO_MS,
  );
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
  assert.deepEqual(await acharCommitComMarca(ambiente, worktree, marca(1)), feito);
  assert.equal(await acharCommitComMarca(ambiente, worktree, marca(2)), undefined);
  const subcomandos = ambiente.argumentosRecebidos.map((a) => a.slice(2).find((x) => !x.startsWith("-")));
  for (const subcomando of ["add", "diff", "rev-parse", "show", "log"]) assert.ok(subcomandos.includes(subcomando));

  // queda antes da gravação: o commit existe, o registro não
  banco.exec("DELETE FROM arquivo_commit_demanda; DELETE FROM commit_ticket_demanda");
  const de_novo = await commitarTicket(
    banco,
    new AmbienteHostLocal(),
    worktree,
    { nome: "p", raiz_git: worktree },
    pedido(1, "feat: Cache"),
    LIMITE_COMANDO_MS,
  );
  assert.equal(de_novo.sha, feito.sha);
  assert.equal(git(worktree, "rev-list", "--count", "HEAD").trim(), "2");
  assert.deepEqual(commitDoTicketDemanda(banco, "I-1", 1), feito);
});

test("com a recusa, o ticket sem alteração é rejeitado com ela, sem commit", async () => {
  const { worktree, banco } = cenario();
  await assert.rejects(
    commitarTicket(
      banco,
      new AmbienteHostLocal(),
      worktree,
      { nome: "p", raiz_git: worktree },
      pedido(1, "fix: Nada", { recusaSemAlteracao: "o ticket I-1.T1 terminou sem alteração na worktree" }),
      LIMITE_COMANDO_MS,
    ),
    (erro) => erro instanceof ErroDeReprovacao && erro.message === "o ticket I-1.T1 terminou sem alteração na worktree",
  );
  assert.equal(git(worktree, "rev-list", "--count", "HEAD").trim(), "1");
});

test("resolver_conflito sem alteração commita o merge vazio com dois pais", async () => {
  const { worktree, banco } = cenario();
  git(worktree, "checkout", "-qb", "outra");
  git(worktree, "commit", "-q", "--allow-empty", "-m", "outra");
  git(worktree, "checkout", "-q", "main");
  git(worktree, "merge", "--no-ff", "--no-commit", "outra");
  const c = await commitarTicket(
    banco,
    new AmbienteHostLocal(),
    worktree,
    { nome: "p", raiz_git: worktree },
    pedido(2, "fix: Nada"),
    LIMITE_COMANDO_MS,
  );
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
  const c = await commitarTicket(
    banco,
    new AmbienteHostLocal(),
    worktree,
    { nome: "p", raiz_git: worktree },
    pedido(2, "fix: Conflito"),
    LIMITE_COMANDO_MS,
  );
  assert.equal(git(worktree, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ").length, 3);
  assert.deepEqual(
    c.arquivos.map((a) => a.caminho),
    ["o.txt"],
  );
});

test("o commit do ticket grava os commits posteriores sobre as linhas do ticket anterior", async () => {
  const { worktree, banco } = cenario();
  escreve(worktree, "a.txt", "a\nb\nc\nd\ne\n");
  await commitarTicket(
    banco,
    new AmbienteHostLocal(),
    worktree,
    { nome: "p", raiz_git: worktree },
    pedido(1, "feat: Um"),
    LIMITE_COMANDO_MS,
  );
  escreve(worktree, "a.txt", "a\nb\nX\nY\nZ\n");
  await commitarTicket(
    banco,
    new AmbienteHostLocal(),
    worktree,
    { nome: "p", raiz_git: worktree },
    pedido(2, "feat: Dois"),
    LIMITE_COMANDO_MS,
  );
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

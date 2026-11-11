// Commits humanos posteriores (F6 §4, §10) contra banco real e git real, com `origin` bare local. Tickets e commits
// de ticket vão direto no banco: o que importa aqui é o histórico que o F6 encontra.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { gravarCommitDemanda } from "../../../demanda/armazenamento/commits_demanda.ts";
import { registrarProjeto } from "../../../ambiente/aplicacao/projeto/cadastro.ts";
import { registrarCommitsHumanosDoTicket, varrerCommitsHumanos } from "./varrer_commits_humanos.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-commits-humanos-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// git sem a configuração do usuário da máquina.
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const linhas = (...l: string[]) => `${l.join("\n")}\n`;
const DEZ = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10"];

let n = 0;
/** Projeto `loja` com `origin` bare, `main` publicada com `humano.txt` (de uma pessoa) e os tickets 1 a 4 concluídos. */
function cenario() {
  const dir = join(base, `c${String(++n)}`);
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  git(base, "init", "-q", "--bare", bare);
  git(base, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  const { banco } = abrirBancoTemporario();
  registrarProjeto(banco, {
    nome: "loja",
    raiz_git: repo,
    branch_base: "main",
    hospedagem: "github",
    chave_sonarqube: "loja",
  });
  const agora = new Date().toISOString();
  banco
    .prepare(
      "INSERT INTO demanda VALUES ('I-1', 'loja', 't', 'problema', 'd', 'em_execucao', ?, 'f', 's', 1, 'fabriquinha/I-1')",
    )
    .run(agora);
  for (const id of [1, 2, 3, 4]) {
    banco
      .prepare(
        `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
         VALUES ('I-1', ?, 'implementar', 'aberto', ?)`,
      )
      .run(id, agora);
  }

  /**
   * Escreve (ou, com `null`, remove) os arquivos, commita tudo e devolve o sha; com `ticket`, registra o commit dele.
   * `autor` muda o autor do commit.
   */
  const commitar = (arquivos: Record<string, string | Buffer | null>, ticket?: number, autor = "Auditor") => {
    for (const [caminho, conteudo] of Object.entries(arquivos)) {
      if (conteudo === null) git(repo, "rm", "-q", caminho);
      else writeFileSync(join(repo, caminho), conteudo);
    }
    git(repo, "add", "-A");
    git(repo, "-c", `user.name=${autor}`, "-c", `user.email=${autor.toLowerCase()}@exemplo.com`, "commit", "-qm", "c");
    const sha = git(repo, "rev-parse", "HEAD");
    if (ticket !== undefined) {
      gravarCommitDemanda(banco, "I-1", ticket, { sha, mensagem: "c", em: agora, arquivos: [] });
    }
    return sha;
  };
  commitar({ "humano.txt": linhas("h1", "h2", "h3") });
  git(repo, "push", "-q", "origin", "main");

  return {
    banco,
    repo,
    commitar,
    publicar: () => git(repo, "push", "-q", "origin", "main"),
    linhasPosteriores: () =>
      banco
        .prepare(
          "SELECT commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id FROM commit_humano_posterior ORDER BY commit_alterador, ticket_origem_id",
        )
        .all()
        .map((l) => ({ ...l })),
    /** As linhas posteriores entre os tickets da I-1, sem as colunas da demanda. */
    linhasPosterioresDeTickets: () =>
      banco
        .prepare(
          `SELECT commit_alterador, ticket_id AS ticket, autor, ticket_origem_id AS ticket_origem, linhas
           FROM commit_humano_posterior ORDER BY commit_alterador, ticket_origem_id`,
        )
        .all()
        .map((l) => ({ ...l })),
    cursor: () =>
      ({ ...banco.prepare("SELECT ultimo_sha, em FROM varredura_base WHERE projeto = 'loja'").get() }) as {
        ultimo_sha?: string;
        em?: string;
      },
  };
}

const deTicket = (sha: string, ticket: number, origem: number, linhas: number) => ({
  commit_alterador: sha,
  ticket,
  autor: null,
  ticket_origem: origem,
  linhas,
});

test("alteração posterior: A cria um arquivo, B reescreve 3 linhas e acrescenta 5; espera a linha (B, A, 3), e de novo dá o mesmo", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas(...DEZ) }, 1);
  const b = c.commitar(
    { "a.txt": linhas("l1", "B2", "l3", "l4", "B5", "l6", "l7", "l8", "B9", "l10", "n1", "n2", "n3", "n4", "n5") },
    2,
  );

  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 2, b);
  assert.deepEqual(c.linhasPosterioresDeTickets(), [deTicket(b, 2, 1, 3)]);
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 2, b);
  assert.deepEqual(c.linhasPosterioresDeTickets(), [deTicket(b, 2, 1, 3)], "idempotente");
  c.banco.close();
});

test("alteração posterior entre vários tickets: cada ticket de origem vira uma linha, e só acrescentar não conta", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2", "a3") }, 1);
  c.commitar({ "b.txt": linhas("b1", "b2") }, 2);
  const so = c.commitar({ "a.txt": linhas("a1", "a2", "a3", "novo"), "c.txt": "c\n" }, 3);
  const d = c.commitar({ "a.txt": linhas("D1", "a2", "a3", "novo"), "b.txt": null }, 4);

  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 3, so);
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 4, d);
  assert.deepEqual(c.linhasPosterioresDeTickets(), [deTicket(d, 4, 1, 1), deTicket(d, 4, 2, 2)].sort(porSha));
  c.banco.close();
});

const porSha = (x: { commit_alterador: string }, y: { commit_alterador: string }) =>
  x.commit_alterador.localeCompare(y.commit_alterador);

test("linha de commit humano é ignorada; um ticket nunca conta alteração posterior sobre si mesmo", async () => {
  const c = cenario();
  c.commitar({ "humano.txt": linhas("A1", "h2", "h3") }, 1);
  const b = c.commitar({ "humano.txt": linhas("B1", "B2", "h3") }, 2);
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 2, b);
  assert.deepEqual(c.linhasPosterioresDeTickets(), [deTicket(b, 2, 1, 1)]);
  // O commit de A mudou a linha de uma pessoa: não é de ticket nenhum.
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 1, git(c.repo, "rev-parse", "HEAD~1"));
  // As linhas de A, contadas para o próprio A, ficariam fora do CHECK do F6 §7.
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 1, b);
  assert.deepEqual(c.linhasPosterioresDeTickets(), [deTicket(b, 2, 1, 1)]);
  c.banco.close();
});

test("CA-11: o segundo ticket da demanda reescreve linhas do primeiro e vai para commit_humano_posterior, idempotente", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas(...DEZ) }, 1);
  const b = c.commitar({ "a.txt": linhas("l1", "B2", "l3", "l4", "B5", "l6", "l7", "l8", "B9", "l10", "n1") }, 2);
  const esperado = [
    {
      commit_alterador: b,
      demanda_id: "I-1",
      ticket_id: 2,
      autor: null,
      ticket_origem_id: 1,
      linhas: 3,
      alterador_demanda_id: "I-1",
    },
  ];
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 2, b);
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 2, b);
  assert.deepEqual(c.linhasPosteriores(), esperado);
  // O ticket nunca conta linhas posteriores sobre si mesmo.
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 1, b);
  assert.deepEqual(c.linhasPosteriores(), esperado);
  // Linha de commit humano não conta.
  const h = c.commitar({ "humano.txt": linhas("H1", "h2", "h3") }, 3);
  await registrarCommitsHumanosDoTicket(c.banco, "I-1", 3, h);
  assert.deepEqual(c.linhasPosteriores(), esperado);
  c.banco.close();
});

test("demanda inexistente é erro", async () => {
  const c = cenario();
  await assert.rejects(
    registrarCommitsHumanosDoTicket(c.banco, "I-99", 1, "0".repeat(40)),
    /a demanda I-99 não existe/,
  );
  c.banco.close();
});

test("varrerBase sem cursor só grava o sha atual de origin/<base> e não conta nada", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2") }, 1);
  c.commitar({ "a.txt": linhas("H1", "a2") }, undefined, "Maria");
  c.publicar();

  await varrerCommitsHumanos(c.banco, "loja");
  assert.equal(c.cursor().ultimo_sha, git(c.repo, "rev-parse", "origin/main"));
  assert.deepEqual(c.linhasPosteriores(), []);
  c.banco.close();
});

test("commit humano na base reescreve 2 linhas de A: (commit, null, autor, A, 2) e cursor avançado", async () => {
  const c = cenario();
  await varrerCommitsHumanos(c.banco, "loja");
  const antes = c.cursor();

  const nove = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];
  c.commitar({ "a.txt": linhas(...nove) }, 1);
  const humano = c.commitar({ "a.txt": linhas("H1", "H2", ...nove.slice(2), "mais") }, undefined, "Maria");
  // Um ticket de outra demanda reescreve as outras duas, numa branch mergeada com merge commit: nem o commit de
  // ticket (já contado em 4.2) nem o merge (cujo diff contra o primeiro pai mostra as duas linhas) geram linha.
  git(c.repo, "checkout", "-q", "-b", "outra", "HEAD~1");
  c.commitar({ "a.txt": linhas("a1", "a2", "a3", "a4", "a5", "T6", "a7", "T8", "a9") }, 2);
  git(c.repo, "checkout", "-q", "main");
  git(c.repo, "merge", "-q", "--no-edit", "outra");
  // Uma história sem relação trazida por merge começa num commit raiz, que não reescreve nada.
  git(c.repo, "checkout", "-q", "--orphan", "solta");
  git(c.repo, "rm", "-rqf", ".");
  c.commitar({ "solta.txt": "s\n" }, undefined, "Maria");
  git(c.repo, "checkout", "-q", "main");
  git(c.repo, "merge", "-q", "--no-edit", "--allow-unrelated-histories", "solta");
  c.publicar();

  await varrerCommitsHumanos(c.banco, "loja");
  assert.deepEqual(c.linhasPosteriores(), [
    {
      commit_alterador: humano,
      demanda_id: "I-1",
      ticket_id: null,
      autor: "Maria <maria@exemplo.com>",
      ticket_origem_id: 1,
      linhas: 2,
      alterador_demanda_id: null,
    },
  ]);
  const depois = c.cursor();
  assert.equal(depois.ultimo_sha, git(c.repo, "rev-parse", "main"));
  assert.ok(String(depois.em) >= String(antes.em));

  // Sem nada novo, a varredura só renova a data.
  await varrerCommitsHumanos(c.banco, "loja");
  assert.equal(c.linhasPosteriores().length, 1);
  c.banco.close();
});

test("force-push que tira o cursor da história gera aviso e recomeça do sha atual", async (t) => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2") }, 1);
  c.publicar();
  await varrerCommitsHumanos(c.banco, "loja");
  const avisos = t.mock.method(console, "error", () => undefined);

  git(c.repo, "reset", "-q", "--hard", "HEAD~1");
  c.commitar({ "a.txt": linhas("x1", "x2") }, undefined, "Maria");
  git(c.repo, "push", "-qf", "origin", "main");
  await varrerCommitsHumanos(c.banco, "loja");

  assert.equal(c.cursor().ultimo_sha, git(c.repo, "rev-parse", "main"));
  assert.deepEqual(c.linhasPosteriores(), []);
  assert.equal(avisos.mock.callCount(), 1);
  assert.match(String(avisos.mock.calls[0]?.arguments.join(" ")), /a base main do projeto loja foi reescrita/);
  c.banco.close();
});

test("varrerBase de projeto inexistente é erro; falha do fetch não move o cursor", async () => {
  const c = cenario();
  await assert.rejects(varrerCommitsHumanos(c.banco, "outro"), /o projeto outro não existe/);
  await varrerCommitsHumanos(c.banco, "loja");
  const antes = c.cursor();
  git(c.repo, "remote", "set-url", "origin", join(base, "nao-existe"));
  await assert.rejects(varrerCommitsHumanos(c.banco, "loja"), /git fetch/);
  assert.deepEqual(c.cursor(), antes);
  c.banco.close();
});

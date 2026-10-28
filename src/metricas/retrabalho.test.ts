// Retrabalho e commits humanos (F6 §4, §10) contra banco real e git real, com `origin` bare local. Tickets e commits
// de ticket vão direto no banco: o que importa aqui é o histórico que o F6 encontra.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { abrir } from "../persistencia/banco.ts";
import { gravarCommit } from "../persistencia/commits.ts";
import { gravarCommitDemanda } from "../persistencia/commits_demanda.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { projetosAVarrer } from "../persistencia/retrabalho.ts";
import { registrarRetrabalho, registrarRetrabalhoDemanda, varrerBase } from "./retrabalho.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-retrabalho-")));
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
  const banco = abrir(join(dir, "raiz"));
  registrarProjeto(banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    testes: ["true"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  });
  const agora = new Date().toISOString();
  banco
    .prepare("INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'loja', 'I', 'problema', ?, ?)")
    .run("desenvolvimento", agora);
  banco
    .prepare(
      "INSERT INTO demanda VALUES ('I-1', 'loja', 't', 'problema', 'd', 'execucao', ?, 'f', 's', 1, 'fabriquinha/I-1')",
    )
    .run(agora);
  for (const id of [1, 2, 3, 4]) {
    banco
      .prepare(
        `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
         VALUES ('I-1', ?, 'implementar', 'aberto', ?)`,
      )
      .run(id, agora);
    banco
      .prepare(
        `INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
         VALUES (?, 1, 'desenvolvimento', 'T', 'concluido', 'fabriquinha', ?, ?)`,
      )
      .run(id, agora, agora);
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
      gravarCommit(banco, ticket, { sha, mensagem: "c", em: agora, arquivos: [] });
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
    retrabalhoDemanda: () =>
      banco
        .prepare(
          "SELECT commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id FROM retrabalho_demanda ORDER BY commit_alterador, ticket_origem_id",
        )
        .all()
        .map((l) => ({ ...l })),
    retrabalho: () =>
      banco
        .prepare("SELECT * FROM retrabalho ORDER BY commit_alterador, ticket_origem")
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

test("retrabalho: A cria um arquivo, B reescreve 3 linhas e acrescenta 5; espera retrabalho(B, A, 3), e de novo dá o mesmo", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas(...DEZ) }, 1);
  const b = c.commitar(
    { "a.txt": linhas("l1", "B2", "l3", "l4", "B5", "l6", "l7", "l8", "B9", "l10", "n1", "n2", "n3", "n4", "n5") },
    2,
  );

  await registrarRetrabalho(c.banco, 2, b);
  assert.deepEqual(c.retrabalho(), [deTicket(b, 2, 1, 3)]);
  await registrarRetrabalho(c.banco, 2, b);
  assert.deepEqual(c.retrabalho(), [deTicket(b, 2, 1, 3)], "idempotente");
  c.banco.close();
});

test("retrabalho entre vários tickets: cada ticket de origem vira uma linha, e só acrescentar não conta", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2", "a3") }, 1);
  c.commitar({ "b.txt": linhas("b1", "b2") }, 2);
  const so = c.commitar({ "a.txt": linhas("a1", "a2", "a3", "novo"), "c.txt": "c\n" }, 3);
  const d = c.commitar({ "a.txt": linhas("D1", "a2", "a3", "novo"), "b.txt": null }, 4);

  await registrarRetrabalho(c.banco, 3, so);
  await registrarRetrabalho(c.banco, 4, d);
  assert.deepEqual(c.retrabalho(), [deTicket(d, 4, 1, 1), deTicket(d, 4, 2, 2)].sort(porSha));
  c.banco.close();
});

const porSha = (x: { commit_alterador: string }, y: { commit_alterador: string }) =>
  x.commit_alterador.localeCompare(y.commit_alterador);

test("arquivo removido conta todas as linhas", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2", "a3", "a4") }, 1);
  const b = c.commitar({ "a.txt": null }, 2);
  await registrarRetrabalho(c.banco, 2, b);
  assert.deepEqual(c.retrabalho(), [deTicket(b, 2, 1, 4)]);
  c.banco.close();
});

test("arquivo renomeado usa o caminho antigo e conta só as linhas reescritas", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2", "a3", "a4", "a5") }, 1);
  git(c.repo, "mv", "a.txt", "nome novo.txt");
  const b = c.commitar({ "nome novo.txt": linhas("a1", "B2", "a3", "a4", "a5") }, 2);
  assert.match(git(c.repo, "show", "-M", "--name-status", "--format=", b), /^R\d+/, "o git vê a renomeação");
  await registrarRetrabalho(c.banco, 2, b);
  assert.deepEqual(c.retrabalho(), [deTicket(b, 2, 1, 1)]);
  c.banco.close();
});

test("blame.ignoreRevsFile da configuração global, sem o arquivo no repositório, não derruba o blame", async (t) => {
  const home = mkdtempSync(join(base, "home-"));
  writeFileSync(
    join(home, ".gitconfig"),
    "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n[blame]\n\tignoreRevsFile = .git-blame-ignore-revs\n",
  );
  const { HOME, GIT_CONFIG_GLOBAL } = process.env;
  t.after(() => {
    Object.assign(process.env, { HOME, GIT_CONFIG_GLOBAL });
  });
  process.env.HOME = home;
  delete process.env.GIT_CONFIG_GLOBAL;

  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2") }, 1);
  const b = c.commitar({ "a.txt": linhas("B1", "a2") }, 2);
  assert.throws(() => git(c.repo, "blame", "HEAD~1", "--", "a.txt"), /could not open object name list/);
  await registrarRetrabalho(c.banco, 2, b);
  assert.deepEqual(c.retrabalho(), [deTicket(b, 2, 1, 1)]);
  // Na configuração do próprio repositório, o blame ainda falha, e o erro diz por quê.
  git(c.repo, "config", "blame.ignoreRevsFile", ".git-blame-ignore-revs");
  await assert.rejects(registrarRetrabalho(c.banco, 2, b), /git blame falhou em .*could not open object name list/);
  c.banco.close();
});

test("caminho com caractere de glob é literal", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2", "a3", "a4"), "[a].txt": "x\n" }, 1);
  const b = c.commitar({ "a.txt": linhas("a1", "a2", "a3", "B4"), "[a].txt": "y\n" }, 2);
  await registrarRetrabalho(c.banco, 2, b);
  assert.deepEqual(c.retrabalho(), [deTicket(b, 2, 1, 2)]);
  c.banco.close();
});

test("arquivo binário e submódulo são ignorados", async () => {
  const c = cenario();
  const sub = join(base, `sub${String(n)}`);
  mkdirSync(sub);
  git(sub, "init", "-q");
  git(sub, "commit", "-q", "--allow-empty", "-m", "um");
  const um = git(sub, "rev-parse", "HEAD");
  git(sub, "commit", "-q", "--allow-empty", "-m", "dois");
  const dois = git(sub, "rev-parse", "HEAD");
  // Submódulo não populado: a pasta vazia, e o gitlink só no índice.
  mkdirSync(join(c.repo, "sub"));
  git(c.repo, "update-index", "--add", "--cacheinfo", `160000,${um},sub`);
  // Um textconv do repositório mostraria o binário como texto: as linhas são as do arquivo versionado.
  git(c.repo, "config", "diff.texto.textconv", "cat");
  c.commitar({ ".gitattributes": "*.bin diff=texto\n", "a.bin": Buffer.from([0, 1, 2, 10, 3, 10]) }, 1);
  git(c.repo, "update-index", "--cacheinfo", `160000,${dois},sub`);
  const b = c.commitar({ "a.bin": Buffer.from([0, 9, 9, 10, 3, 10]) }, 2);
  await registrarRetrabalho(c.banco, 2, b);
  assert.deepEqual(c.retrabalho(), []);
  c.banco.close();
});

test("linha de commit humano é ignorada; um ticket nunca conta retrabalho sobre si mesmo", async () => {
  const c = cenario();
  c.commitar({ "humano.txt": linhas("A1", "h2", "h3") }, 1);
  const b = c.commitar({ "humano.txt": linhas("B1", "B2", "h3") }, 2);
  await registrarRetrabalho(c.banco, 2, b);
  assert.deepEqual(c.retrabalho(), [deTicket(b, 2, 1, 1)]);
  // O commit de A mudou a linha de uma pessoa: não é retrabalho de ticket nenhum.
  await registrarRetrabalho(c.banco, 1, git(c.repo, "rev-parse", "HEAD~1"));
  // As linhas de A, contadas para o próprio A, ficariam fora do CHECK do F6 §7.
  await registrarRetrabalho(c.banco, 1, b);
  assert.deepEqual(c.retrabalho(), [deTicket(b, 2, 1, 1)]);
  c.banco.close();
});

test("CA-11: o segundo ticket da demanda reescreve linhas do primeiro e vai para retrabalho_demanda, idempotente", async () => {
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
  await registrarRetrabalhoDemanda(c.banco, "I-1", 2, b);
  await registrarRetrabalhoDemanda(c.banco, "I-1", 2, b);
  assert.deepEqual(c.retrabalhoDemanda(), esperado);
  // O ticket nunca conta retrabalho sobre si mesmo.
  await registrarRetrabalhoDemanda(c.banco, "I-1", 1, b);
  assert.deepEqual(c.retrabalhoDemanda(), esperado);
  // Linha de commit humano não conta.
  const h = c.commitar({ "humano.txt": linhas("H1", "h2", "h3") }, 3);
  await registrarRetrabalhoDemanda(c.banco, "I-1", 3, h);
  assert.deepEqual(c.retrabalhoDemanda(), esperado);
  c.banco.close();
});

test("demanda inexistente é erro", async () => {
  const c = cenario();
  await assert.rejects(registrarRetrabalhoDemanda(c.banco, "I-99", 1, "0".repeat(40)), /a demanda I-99 não existe/);
  c.banco.close();
});

test("ticket inexistente é erro", async () => {
  const c = cenario();
  await assert.rejects(registrarRetrabalho(c.banco, 99, "0".repeat(40)), /o ticket T-99 não existe/);
  c.banco.close();
});

test("varrerBase sem cursor só grava o sha atual de origin/<base> e não conta nada", async () => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2") }, 1);
  c.commitar({ "a.txt": linhas("H1", "a2") }, undefined, "Maria");
  c.publicar();

  await varrerBase(c.banco, "loja");
  assert.equal(c.cursor().ultimo_sha, git(c.repo, "rev-parse", "origin/main"));
  assert.deepEqual(c.retrabalhoDemanda(), []);
  c.banco.close();
});

test("commit humano na base reescreve 2 linhas de A: retrabalho(commit, null, autor, A, 2) e cursor avançado", async () => {
  const c = cenario();
  await varrerBase(c.banco, "loja");
  const antes = c.cursor();

  const nove = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];
  c.commitar({ "a.txt": linhas(...nove) }, 1);
  const humano = c.commitar({ "a.txt": linhas("H1", "H2", ...nove.slice(2), "mais") }, undefined, "Maria");
  // Um ticket de outra issue reescreve as outras duas, numa branch mergeada com merge commit: nem o commit de
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

  await varrerBase(c.banco, "loja");
  assert.deepEqual(c.retrabalhoDemanda(), [
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
  await varrerBase(c.banco, "loja");
  assert.equal(c.retrabalhoDemanda().length, 1);
  assert.deepEqual(c.retrabalho(), []);
  c.banco.close();
});

test("force-push que tira o cursor da história gera aviso e recomeça do sha atual", async (t) => {
  const c = cenario();
  c.commitar({ "a.txt": linhas("a1", "a2") }, 1);
  c.publicar();
  await varrerBase(c.banco, "loja");
  const avisos = t.mock.method(console, "error", () => undefined);

  git(c.repo, "reset", "-q", "--hard", "HEAD~1");
  c.commitar({ "a.txt": linhas("x1", "x2") }, undefined, "Maria");
  git(c.repo, "push", "-qf", "origin", "main");
  await varrerBase(c.banco, "loja");

  assert.equal(c.cursor().ultimo_sha, git(c.repo, "rev-parse", "main"));
  assert.deepEqual(c.retrabalhoDemanda(), []);
  assert.equal(avisos.mock.callCount(), 1);
  assert.match(String(avisos.mock.calls[0]?.arguments.join(" ")), /a base main do projeto loja foi reescrita/);
  c.banco.close();
});

test("varrerBase de projeto inexistente é erro; falha do fetch não move o cursor", async () => {
  const c = cenario();
  await assert.rejects(varrerBase(c.banco, "outro"), /o projeto outro não existe/);
  await varrerBase(c.banco, "loja");
  const antes = c.cursor();
  git(c.repo, "remote", "set-url", "origin", join(base, "nao-existe"));
  await assert.rejects(varrerBase(c.banco, "loja"), /git fetch/);
  assert.deepEqual(c.cursor(), antes);
  c.banco.close();
});

test("projetosAVarrer: os sem varredura e os varridos há mais de 24 horas, em ordem de nome", () => {
  const c = cenario();
  const cadastrar = (nome: string) => {
    registrarProjeto(c.banco, {
      nome,
      repo: `/repo/${nome}`,
      branchBase: "main",
      hospedagem: "github",
      testes: ["true"],
      sonar: { projectKey: nome },
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    });
  };
  cadastrar("velho");
  cadastrar("novo");
  const agora = new Date("2026-10-11T12:00:00.000Z");
  const varrido = (projeto: string, em: string) =>
    c.banco
      .prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES (?, ?, ?)")
      .run(projeto, "a".repeat(40), em);
  varrido("velho", "2026-10-10T11:59:59.999Z");
  varrido("novo", "2026-10-10T12:00:00.000Z");

  assert.deepEqual(projetosAVarrer(c.banco, agora), ["loja", "velho"]);
  c.banco.close();
});

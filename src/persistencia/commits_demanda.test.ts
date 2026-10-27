import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { migrar } from "./banco.ts";
import type { ArquivoCommit, Commit } from "./commits.ts";
import {
  commitDoTicketDemanda,
  gravarCommitDemanda,
  gravarRetrabalhoDoTicket,
  gravarRetrabalhoExterno,
  retrabalhoDoTicket,
} from "./commits_demanda.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const sha = (c: string) => c.repeat(40);

const banco = () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
    VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]')`);
  for (const d of ["D", "E"]) {
    b.exec(
      `INSERT INTO demanda VALUES ('${d}', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/${d}')`,
    );
  }
  for (const [d, n] of [
    ["D", 1],
    ["D", 2],
    ["D", 3],
    ["E", 1],
    ["E", 9],
  ] as const) {
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('${d}', ${String(n)}, 'implementar', 'aberto', ${T})`);
  }
  return b;
};
const commit = (c: string, arquivos: ArquivoCommit[] = []): Commit => ({
  sha: sha(c),
  mensagem: "m",
  em: "2026-01-02",
  arquivos,
});
const arq = (caminho: string, status: ArquivoCommit["status"], extra: Partial<ArquivoCommit> = {}): ArquivoCommit => ({
  caminho,
  status,
  adicionadas: 1,
  removidas: 2,
  ...extra,
});

test("CA-1: grava e consulta o commit", () => {
  const b = banco();
  assert.equal(commitDoTicketDemanda(b, "D", 1), undefined);
  gravarCommitDemanda(b, "D", 1, commit("a"));
  assert.deepEqual(commitDoTicketDemanda(b, "D", 1), commit("a"));
});

test("CA-2: outro sha para o mesmo ticket é recusado", () => {
  const b = banco();
  gravarCommitDemanda(b, "D", 1, commit("a"));
  assert.throws(() => {
    gravarCommitDemanda(b, "D", 1, commit("b"));
  }, ErroDeRegra);
  assert.equal(commitDoTicketDemanda(b, "D", 1)?.sha, sha("a"));
});

test("CA-3: gravar o mesmo commit de novo não duplica", () => {
  const b = banco();
  const c = commit("a", [arq("x.ts", "M")]);
  gravarCommitDemanda(b, "D", 1, c);
  gravarCommitDemanda(b, "D", 1, c);
  assert.deepEqual(commitDoTicketDemanda(b, "D", 1), c);
});

test("CA-4: sha de outro ticket, da mesma demanda ou de outra, é recusado", () => {
  const b = banco();
  gravarCommitDemanda(b, "D", 1, commit("a"));
  assert.throws(() => {
    gravarCommitDemanda(b, "D", 2, commit("a"));
  }, ErroDeRegra);
  assert.throws(() => {
    gravarCommitDemanda(b, "E", 1, commit("a"));
  }, ErroDeRegra);
  assert.equal(commitDoTicketDemanda(b, "D", 2), undefined);
  assert.equal(commitDoTicketDemanda(b, "E", 1), undefined);
});

test("CA-5 e CA-6: A, M, D, R e binário", () => {
  const b = banco();
  const c = commit("a", [
    arq("n.ts", "A"),
    arq("m.ts", "M"),
    arq("d.ts", "D"),
    arq("b.ts", "R", { caminhoAnterior: "a.ts" }),
    arq("i.png", "A", { adicionadas: null, removidas: null }),
  ]);
  gravarCommitDemanda(b, "D", 1, c);
  assert.deepEqual(commitDoTicketDemanda(b, "D", 1), c);
});

test("CA-7: arquivo inconsistente recusa o commit inteiro", () => {
  const b = banco();
  const ruim = [arq("a.ts", "M"), arq("b.ts", "R"), arq("c.ts", "M")];
  assert.throws(() => {
    gravarCommitDemanda(b, "D", 1, commit("a", ruim));
  }, ErroDeRegra);
  assert.throws(() => {
    gravarCommitDemanda(b, "D", 1, commit("a", [arq("a.ts", "M", { caminhoAnterior: "x" })]));
  }, ErroDeRegra);
  assert.equal(commitDoTicketDemanda(b, "D", 1), undefined);
  assert.equal(b.prepare("SELECT 1 FROM arquivo_commit_demanda").all().length, 0);
});

test("commit de ticket inexistente é recusado", () => {
  assert.throws(() => {
    gravarCommitDemanda(banco(), "D", 99, commit("a"));
  }, ErroDeRegra);
});

test("CA-8: regravar o retrabalho do ticket troca as linhas", () => {
  const b = banco();
  gravarRetrabalhoDoTicket(b, "D", 2, sha("a"), new Map([[1, 5]]));
  gravarRetrabalhoDoTicket(b, "D", 2, sha("a"), new Map([[3, 2]]));
  assert.deepEqual(retrabalhoDoTicket(b, "D", 1), []);
  assert.deepEqual(retrabalhoDoTicket(b, "D", 3), [{ commitAlterador: sha("a"), ticketAlterador: 2, linhas: 2 }]);
});

test("CA-9: o retrabalho traz o ticket alterador", () => {
  const b = banco();
  gravarRetrabalhoDoTicket(b, "D", 2, sha("a"), new Map([[1, 5]]));
  assert.deepEqual(retrabalhoDoTicket(b, "D", 1), [{ commitAlterador: sha("a"), ticketAlterador: 2, linhas: 5 }]);
});

test("CA-10: o retrabalho externo traz o autor, e regravar não duplica", () => {
  const b = banco();
  gravarRetrabalhoExterno(b, "D", sha("a"), "Ana", new Map([[1, 3]]));
  gravarRetrabalhoExterno(b, "D", sha("a"), "Ana", new Map([[1, 3]]));
  assert.deepEqual(retrabalhoDoTicket(b, "D", 1), [{ commitAlterador: sha("a"), autor: "Ana", linhas: 3 }]);
});

test("CA-11: origem de outra demanda é recusada e nada fica gravado", () => {
  const b = banco();
  assert.throws(() => {
    gravarRetrabalhoDoTicket(
      b,
      "D",
      2,
      sha("a"),
      new Map([
        [3, 1],
        [9, 4],
      ]),
    );
  }, ErroDeRegra);
  assert.throws(() => {
    gravarRetrabalhoExterno(b, "D", sha("a"), "Ana", new Map([[9, 4]]));
  }, ErroDeRegra);
  assert.equal(b.prepare("SELECT 1 FROM retrabalho_demanda").all().length, 0);
});

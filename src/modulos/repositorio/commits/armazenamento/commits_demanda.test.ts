import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import type { ArquivoCommit, Commit } from "../nucleo/commits.ts";
import {
  commitDoTicketDemanda,
  gravarCommitDemanda,
  gravarCommitsPosterioresDoTicket,
  gravarCommitHumanoPosterior,
  metricasDosCommits,
} from "./commits_demanda.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const sha = (c: string) => c.repeat(40);
const em = (demanda: string, linhas: [number, number][]) => new Map([[demanda, new Map(linhas)]]);

const banco = () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrarBancoDaFabriquinha(b);
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k')`);
  for (const d of ["D", "E"]) {
    b.exec(
      `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('${d}', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/${d}');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda)`,
    );
  }
  for (const [d, n] of [
    ["D", 1],
    ["D", 2],
    ["D", 3],
    ["E", 1],
    ["E", 9],
  ] as const) {
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('${d}', ${String(n)}, 'implementar', 'aberto', ${T})`);
  }
  return b;
};
/** Lê o que a gravação deixou em `commit_humano_posterior` para o ticket de origem; a produção só lê isso por agregação. */
const commitsPosterioresDoTicket = (b: DatabaseSync, demandaId: string, origem: number) =>
  b
    .prepare(
      `SELECT commit_alterador, ticket_id, alterador_demanda_id, autor, linhas FROM commit_humano_posterior
       WHERE demanda_id = ? AND ticket_origem_id = ? ORDER BY rowid`,
    )
    .all(demandaId, origem)
    .map((l) => ({
      commitAlterador: l.commit_alterador as string,
      ...(l.ticket_id === null ? { autor: l.autor as string } : { ticketAlterador: l.ticket_id as number }),
      ...(l.alterador_demanda_id === null || l.alterador_demanda_id === demandaId
        ? {}
        : { demandaAlteradora: l.alterador_demanda_id as string }),
      linhas: l.linhas as number,
    }));
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

test("CA-2: outro sha para o mesmo ticket é rejeitado", () => {
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

test("CA-4: sha de outro ticket, da mesma demanda ou de outra, é rejeitado", () => {
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

test("commit de ticket inexistente é rejeitado", () => {
  assert.throws(() => {
    gravarCommitDemanda(banco(), "D", 99, commit("a"));
  }, ErroDeRegra);
});

test("CA-8: regravar os commits posteriores do ticket troca as linhas", () => {
  const b = banco();
  gravarCommitsPosterioresDoTicket(b, "D", 2, sha("a"), em("D", [[1, 5]]));
  gravarCommitsPosterioresDoTicket(b, "D", 2, sha("a"), em("D", [[3, 2]]));
  assert.deepEqual(commitsPosterioresDoTicket(b, "D", 1), []);
  assert.deepEqual(commitsPosterioresDoTicket(b, "D", 3), [
    { commitAlterador: sha("a"), ticketAlterador: 2, linhas: 2 },
  ]);
});

test("CA-9: os commits posteriores trazem o ticket alterador", () => {
  const b = banco();
  gravarCommitsPosterioresDoTicket(b, "D", 2, sha("a"), em("D", [[1, 5]]));
  assert.deepEqual(commitsPosterioresDoTicket(b, "D", 1), [
    { commitAlterador: sha("a"), ticketAlterador: 2, linhas: 5 },
  ]);
});

test("o alterador de outra demanda aparece em demandaAlteradora e a regravação não apaga o dele", () => {
  const b = banco();
  b.exec(`INSERT INTO commit_humano_posterior VALUES ('${sha("b")}', 'D', 1, NULL, 3, 4, 'E')`);
  gravarCommitsPosterioresDoTicket(b, "D", 1, sha("a"), em("D", [[2, 1]]));
  assert.deepEqual(commitsPosterioresDoTicket(b, "D", 3), [
    { commitAlterador: sha("b"), ticketAlterador: 1, demandaAlteradora: "E", linhas: 4 },
  ]);
  assert.deepEqual(commitsPosterioresDoTicket(b, "D", 2), [
    { commitAlterador: sha("a"), ticketAlterador: 1, linhas: 1 },
  ]);
});

test("CA-10: o commit humano posterior traz o autor, e regravar não duplica", () => {
  const b = banco();
  gravarCommitHumanoPosterior(b, sha("a"), "Ana", em("D", [[1, 3]]));
  gravarCommitHumanoPosterior(b, sha("a"), "Ana", em("D", [[1, 3]]));
  assert.deepEqual(commitsPosterioresDoTicket(b, "D", 1), [{ commitAlterador: sha("a"), autor: "Ana", linhas: 3 }]);
});

test("CA-11: origem de outra demanda é rejeitada e nada fica gravado", () => {
  const b = banco();
  assert.throws(() => {
    gravarCommitsPosterioresDoTicket(
      b,
      "D",
      2,
      sha("a"),
      em("D", [
        [3, 1],
        [9, 4],
      ]),
    );
  }, ErroDeRegra);
  assert.throws(() => {
    gravarCommitHumanoPosterior(b, sha("a"), "Ana", em("D", [[9, 4]]));
  }, ErroDeRegra);
  assert.equal(b.prepare("SELECT 1 FROM commit_humano_posterior").all().length, 0);
});

test("em lote: os commits das demandas com as linhas adicionadas e as que uma pessoa alterou, e os arquivos deles", () => {
  const b = banco();
  gravarCommitDemanda(b, "D", 1, commit("a", [arq("x.ts", "M"), arq("y.ts", "R", { caminhoAnterior: "w.ts" })]));
  gravarCommitDemanda(b, "E", 1, { ...commit("b", [arq("z.ts", "A", { adicionadas: null })]), em: "2026-02-01" });
  gravarCommitHumanoPosterior(b, sha("c"), "Ana", em("D", [[1, 3]]));
  gravarCommitsPosterioresDoTicket(b, "D", 2, sha("d"), em("D", [[1, 7]])); // de ticket, não de pessoa: não conta
  const { alteracoes, commits } = metricasDosCommits(b, { demandas: ["D", "E"], periodo: {} });
  assert.deepEqual(alteracoes, [
    {
      sha: sha("a"),
      demanda_id: "D",
      ticket_id: 1,
      em: "2026-01-02",
      linhasAdicionadas: 2,
      linhasAlteradasPorHumanos: 3,
    },
    {
      sha: sha("b"),
      demanda_id: "E",
      ticket_id: 1,
      em: "2026-02-01",
      linhasAdicionadas: 0,
      linhasAlteradasPorHumanos: 0,
    },
  ]);
  const deFevereiro = metricasDosCommits(b, { demandas: ["D", "E"], periodo: { inicio: "2026-02", fim: "2026-03" } });
  assert.deepEqual(
    deFevereiro.alteracoes.map((c) => c.demanda_id),
    ["E"],
  );
  assert.equal(deFevereiro.commits.length, 2, "os commits da conformidade valem para qualquer período");
  assert.deepEqual(commits, [
    {
      sha: sha("a"),
      demanda_id: "D",
      ticket_id: 1,
      em: "2026-01-02",
      arquivos: [
        { caminho: "x.ts", caminhoAnterior: null },
        { caminho: "y.ts", caminhoAnterior: "w.ts" },
      ],
    },
    {
      sha: sha("b"),
      demanda_id: "E",
      ticket_id: 1,
      em: "2026-02-01",
      arquivos: [{ caminho: "z.ts", caminhoAnterior: null }],
    },
  ]);
});

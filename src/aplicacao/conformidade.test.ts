import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeInexistente } from "../nucleo/erros.ts";
import { migrar } from "../armazenamento/banco.ts";
import { MIGRACOES } from "../armazenamento/migracoes.ts";
import { planoDaDemanda } from "../armazenamento/metricas_demanda.ts";
import { conformidadeDaRodada as conformidadeDoPlano } from "./conformidade.ts";

const conformidadeDaRodada = (b: DatabaseSync, demandaId: string, rodadaId: number) =>
  conformidadeDoPlano(b, demandaId, rodadaId, planoDaDemanda(b, demandaId));

const T = "'2026-01-01T00:00:00.000Z'";
const sha = (n: number) => String(n).padStart(40, "0");

/** Demanda I-1 com planejar (T1), rodada 1 com a implementação T2, e T3 corretivo (fora do plano) na rodada 1; o Plano vem de `versao_plano`. */
const banco = (planejado: string[] | null = ["a", "b", "c", "d"], correcoes: string[][] = []) => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k')`);
  b.exec(
    `INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1')`,
  );
  b.exec(
    "INSERT INTO rodada VALUES ('I-1', 1, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'fabriquinha/I-1-1')",
  );
  b.exec(
    "INSERT INTO rodada VALUES ('I-1', 2, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'fabriquinha/I-1-2')",
  );
  for (const [n, etapa, rodada] of [
    [1, "planejar", "NULL"],
    [2, "implementar", "1"],
    [3, "implementar", "1"],
    [4, "implementar", "2"],
  ] as const)
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
      VALUES ('I-1', ${String(n)}, '${etapa}', 'concluido', ${T}, ${rodada})`);
  if (planejado) {
    const rodada = (rodada_id: number) => ({
      demanda_id: "I-1",
      rodada_id,
      titulo: "r",
      e2e: false,
      arquivos_previstos: planejado,
    });
    const plano = {
      demanda_id: "I-1",
      criterios: [],
      arquivos_previstos: planejado,
      rodadas: [rodada(1)],
      tickets: [
        { demanda_id: "I-1", ticket_id: 2, rodada_id: 1, titulo: "t", descricao: "d", arquivos_previstos: planejado },
      ],
    };
    const gravaVersao = (numero: number, origem: string, dados: object) =>
      b
        .prepare(
          `INSERT INTO versao_plano (demanda_id, numero, origem, autor_tipo, criada_em, dados)
           VALUES ('I-1', ?, ?, 'fabriquinha', ${T}, ?)`,
        )
        .run(numero, origem, JSON.stringify(dados));
    gravaVersao(1, "aprovacao_do_planejamento", plano);
    for (const [i, arquivos] of correcoes.entries())
      gravaVersao(i + 2, "revisao_rodada", {
        origem: "revisao_rodada",
        autor: { tipo: "fabriquinha" },
        rodada: 1,
        rodadas_novas: [],
        tickets_novos: [
          { demanda_id: "I-1", ticket_id: 3, rodada_id: 1, titulo: "c", descricao: "d", arquivos_previstos: arquivos },
        ],
        arquivos_acrescentados: arquivos,
      });
  }
  return b;
};
const commit = (b: DatabaseSync, ticket: number, arquivos: [string, string, string?][]) => {
  b.exec(`INSERT INTO commit_ticket_demanda VALUES ('${sha(ticket)}', 'I-1', ${String(ticket)}, 'm', ${T})`);
  for (const [caminho, status, anterior] of arquivos)
    b.prepare("INSERT INTO arquivo_commit_demanda VALUES (?, ?, ?, ?, 1, 1)").run(
      sha(ticket),
      caminho,
      anterior ?? null,
      status,
    );
};

test("CA-9 e CA-10: 3 comuns em 5 da união dão 60 %, com ausentes e extras", () => {
  const b = banco();
  commit(b, 2, [
    ["a", "M"],
    ["b", "M"],
    ["c", "A"],
    ["e", "A"],
  ]);
  assert.deepEqual(conformidadeDaRodada(b, "I-1", 1), {
    percentual: 60,
    comuns: 3,
    uniao: 5,
    ausentes: ["d"],
    extras: ["e"],
  });
});

test("CA-11: caminho do ticket corretivo aparece como extra e o plano não muda", () => {
  const b = banco(["a"], [["z"]]);
  commit(b, 2, [["a", "M"]]);
  commit(b, 3, [["z", "A"]]);
  const r = conformidadeDaRodada(b, "I-1", 1);
  assert.deepEqual(r?.extras, ["z"]);
  assert.equal(r.percentual, 50);
});

test("CA-12: renome conta pelo caminho novo e o anterior planejado não é ausente", () => {
  const b = banco(["a"]);
  commit(b, 2, [["b", "R", "a"]]);
  const r = conformidadeDaRodada(b, "I-1", 1);
  assert.deepEqual([r?.ausentes, r?.extras, r?.comuns], [[], ["b"], 1]);
});

test("renome de caminho fora do plano não cria extra do caminho anterior", () => {
  const b = banco(["a"]);
  commit(b, 2, [
    ["a", "M"],
    ["y", "R", "x"],
  ]);
  assert.deepEqual(conformidadeDaRodada(b, "I-1", 1)?.extras, ["y"]);
});

test("CA-13: exclusão conta como alterado", () => {
  const b = banco();
  commit(b, 2, [["c", "D"]]);
  const r = conformidadeDaRodada(b, "I-1", 1);
  assert.deepEqual(r?.ausentes, ["a", "b", "d"]);
  assert.equal(r.comuns, 1);
});

test("sem plano original, sem caminhos planejados ou sem commit: null", () => {
  const sem = banco(null);
  commit(sem, 2, [["a", "M"]]);
  assert.equal(conformidadeDaRodada(sem, "I-1", 1), null);
  // A correção sem plano aprovado antes (demanda antiga sem evidência `plano`) não é lida como o original.
  sem.exec(`INSERT INTO versao_plano (demanda_id, numero, origem, autor_tipo, criada_em, dados)
    VALUES ('I-1', 1, 'ajustar_resultado', 'auditor', ${T}, '{}')`);
  assert.equal(conformidadeDaRodada(sem, "I-1", 1), null);
  const corretiva = banco();
  commit(corretiva, 4, [["a", "M"]]);
  assert.equal(conformidadeDaRodada(corretiva, "I-1", 2), null);
  const vazio = banco([]);
  commit(vazio, 2, [["a", "M"]]);
  assert.equal(conformidadeDaRodada(vazio, "I-1", 1), null);
  assert.equal(conformidadeDaRodada(banco(), "I-1", 1), null);
});

test("demanda ou rodada inexistente lança ErroDeInexistente", () => {
  const b = banco();
  assert.throws(() => conformidadeDaRodada(b, "I-9", 1), ErroDeInexistente);
  assert.throws(() => conformidadeDaRodada(b, "I-1", 9), ErroDeInexistente);
});

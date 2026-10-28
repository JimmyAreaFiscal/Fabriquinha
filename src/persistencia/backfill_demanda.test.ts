import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { backfillDemandas } from "./backfill_demanda.ts";
import { carregarDemanda } from "./demandas.ts";
import { montarFixture, SHA_3, SHA_6, SHA_HUMANO } from "./fixture_backfill.test.ts";

const ler = (b: DatabaseSync, sql: string) =>
  b
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));
const LEGADAS = [
  "issue",
  "issue_dep",
  "ticket",
  "decisao",
  "commit_ticket",
  "arquivo_commit",
  "retrabalho",
  "sequencia",
];
const legado = (b: DatabaseSync) => LEGADAS.map((t) => ler(b, `SELECT * FROM ${t} ORDER BY rowid`));
const NOVAS = [
  "demanda",
  "rodada",
  "ticket_demanda",
  "decisao_ticket",
  "commit_ticket_demanda",
  "arquivo_commit_demanda",
  "retrabalho_demanda",
  "dependencia_demanda",
  "demanda_historico",
  "decisao_ticket_historico",
];
const novas = (b: DatabaseSync) => NOVAS.map((t) => ler(b, `SELECT * FROM ${t} ORDER BY rowid`));

test("CA-1, CA-3, CA-4: demandas, rodada 1 e tickets com os números e datas do legado; cada demanda carrega", () => {
  const b = montarFixture();
  backfillDemandas(b);
  assert.deepEqual(
    ler(
      b,
      "SELECT id, fase, fase_alterada_em, titulo, tipo, branch, enviada, origem_ferramenta, origem_sessao FROM demanda",
    ),
    [
      {
        id: "I-1",
        fase: "concluida",
        fase_alterada_em: "2026-01-09T00:00:00.000Z",
        titulo: "Concluída",
        tipo: "problema",
        branch: "fabriquinha/I-1",
        enviada: 1,
        origem_ferramenta: "legado",
        origem_sessao: "backfill",
      },
      {
        id: "I-2",
        fase: "arquivada",
        fase_alterada_em: "2026-01-11T00:00:00.000Z",
        titulo: "Arquivada",
        tipo: "funcionalidade",
        branch: "fabriquinha/I-2",
        enviada: 1,
        origem_ferramenta: "legado",
        origem_sessao: "backfill",
      },
      {
        id: "I-3",
        fase: "cancelada",
        fase_alterada_em: "2026-01-12T00:00:00.000Z",
        titulo: "Cancelada no desenho",
        tipo: "funcionalidade",
        branch: "fabriquinha/I-3",
        enviada: 1,
        origem_ferramenta: "legado",
        origem_sessao: "backfill",
      },
      {
        id: "I-4",
        fase: "cancelada",
        fase_alterada_em: "2026-01-13T00:00:00.000Z",
        titulo: "Registro cancelado I-4",
        tipo: "funcionalidade",
        branch: "fabriquinha/I-4",
        enviada: 1,
        origem_ferramenta: "legado",
        origem_sessao: "backfill",
      },
    ],
  );
  assert.deepEqual(
    ler(
      b,
      "SELECT demanda_id, criada_em, concluida_em, cancelada_em, arquivada_em FROM demanda_historico WHERE demanda_id IN ('I-2', 'I-3')",
    ),
    [
      {
        demanda_id: "I-2",
        criada_em: "2026-01-02T00:00:00.000Z",
        concluida_em: "2026-01-10T00:00:00.000Z",
        cancelada_em: null,
        arquivada_em: "2026-01-11T00:00:00.000Z",
      },
      {
        demanda_id: "I-3",
        criada_em: "2026-01-03T00:00:00.000Z",
        concluida_em: null,
        cancelada_em: "2026-01-12T00:00:00.000Z",
        arquivada_em: null,
      },
    ],
  );
  assert.deepEqual(ler(b, "SELECT * FROM rodada"), [
    {
      demanda_id: "I-1",
      rodada_id: 1,
      titulo: "Histórico migrado",
      fase: "concluida",
      e2e: 0,
      branch: "fabriquinha/I-1-1",
    },
    {
      demanda_id: "I-2",
      rodada_id: 1,
      titulo: "Histórico migrado",
      fase: "concluida",
      e2e: 0,
      branch: "fabriquinha/I-2-1",
    },
  ]);
  assert.deepEqual(
    ler(
      b,
      "SELECT demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id FROM ticket_demanda WHERE ticket_id <= 4 OR ticket_id = 8",
    ),
    [
      {
        demanda_id: "I-1",
        ticket_id: 1,
        etapa: "demanda",
        status: "concluido",
        status_alterado_em: "2026-01-01T00:00:00.000Z",
        rodada_id: null,
      },
      {
        demanda_id: "I-1",
        ticket_id: 2,
        etapa: "planejar",
        status: "concluido",
        status_alterado_em: "2026-01-03T00:00:00.000Z",
        rodada_id: null,
      },
      {
        demanda_id: "I-1",
        ticket_id: 3,
        etapa: "implementar",
        status: "concluido",
        status_alterado_em: "2026-01-05T00:00:00.000Z",
        rodada_id: 1,
      },
      {
        demanda_id: "I-1",
        ticket_id: 4,
        etapa: "implementar",
        status: "falhou",
        status_alterado_em: "2026-01-05T00:00:00.000Z",
        rodada_id: 1,
      },
      {
        demanda_id: "I-3",
        ticket_id: 8,
        etapa: "planejar",
        status: "falhou",
        status_alterado_em: "2026-01-04T00:00:00.000Z",
        rodada_id: null,
      },
    ],
  );
  assert.deepEqual(
    ler(b, "SELECT * FROM ticket_demanda WHERE ticket_id IN (3, 8)").map(
      ({
        demanda_id,
        ticket_id,
        titulo,
        descricao,
        modelo_provedor,
        modelo_nome,
        instrucao,
        devolucoes,
        motivo_falha,
        criado_em,
        concluido_em,
        enviado_em,
        origem,
        origem_ticket_id,
      }) => ({
        demanda_id,
        ticket_id,
        titulo,
        descricao,
        modelo_provedor,
        modelo_nome,
        instrucao,
        devolucoes,
        motivo_falha,
        criado_em,
        concluido_em,
        enviado_em,
        origem,
        origem_ticket_id,
      }),
    ),
    [
      {
        demanda_id: "I-1",
        ticket_id: 3,
        titulo: "Dev A",
        descricao: "r",
        modelo_provedor: "anthropic",
        modelo_nome: "sonnet",
        instrucao: "refaça",
        devolucoes: 2,
        motivo_falha: null,
        criado_em: "2026-01-04T00:00:00.000Z",
        concluido_em: "2026-01-05T00:00:00.000Z",
        enviado_em: null,
        origem: "fabriquinha",
        origem_ticket_id: null,
      },
      {
        demanda_id: "I-3",
        ticket_id: 8,
        titulo: "Desenho",
        descricao: "r",
        modelo_provedor: null,
        modelo_nome: null,
        instrucao: "sem rumo",
        devolucoes: 0,
        motivo_falha: "erro do desenho",
        criado_em: "2026-01-04T00:00:00.000Z",
        concluido_em: null,
        enviado_em: "2026-01-04T00:00:00.000Z",
        origem: "fabriquinha",
        origem_ticket_id: null,
      },
    ],
  );
  assert.equal(ler(b, "SELECT origem_ticket_id FROM ticket_demanda WHERE ticket_id = 4")[0]?.origem_ticket_id, 3);
  assert.equal(ler(b, "SELECT devolucoes FROM ticket_demanda WHERE ticket_id = 5")[0]?.devolucoes, 1);
  for (const { id } of ler(b, "SELECT id FROM demanda")) assert.ok(carregarDemanda(b, String(id)));
});

test("CA-2: decisao_ticket tem exatamente as decisões do legado, e o gate fica no histórico", () => {
  const b = montarFixture();
  backfillDemandas(b);
  assert.deepEqual(
    ler(b, "SELECT decisao_id, ticket_id, resultado, nota, motivo, por, em FROM decisao_ticket ORDER BY decisao_id"),
    [
      {
        decisao_id: 1,
        ticket_id: 2,
        resultado: "recusado",
        nota: null,
        motivo: "refaça",
        por: "auditor",
        em: "2026-01-02T00:00:00.000Z",
      },
      {
        decisao_id: 2,
        ticket_id: 2,
        resultado: "aprovado",
        nota: null,
        motivo: null,
        por: "auditor",
        em: "2026-01-03T00:00:00.000Z",
      },
      {
        decisao_id: 3,
        ticket_id: 3,
        resultado: "aprovado",
        nota: null,
        motivo: null,
        por: "agente",
        em: "2026-01-07T00:00:00.000Z",
      },
      {
        decisao_id: 4,
        ticket_id: 5,
        resultado: "aprovado",
        nota: 5,
        motivo: null,
        por: "auditor",
        em: "2026-01-09T00:00:00.000Z",
      },
    ],
  );
  assert.deepEqual(
    ler(b, "SELECT decisao_id, gate FROM decisao_ticket_historico ORDER BY decisao_id").map((l) => l.gate),
    ["desenho", "desenho", "revisao", "pr"],
  );
});

test("CA-5, CA-6: commits, arquivos e retrabalho copiados, com o alterador de outra issue e o humano", () => {
  const b = montarFixture();
  backfillDemandas(b);
  assert.deepEqual(ler(b, "SELECT sha, demanda_id, ticket_id, mensagem FROM commit_ticket_demanda"), [
    { sha: SHA_3, demanda_id: "I-1", ticket_id: 3, mensagem: "feat: a" },
    { sha: SHA_6, demanda_id: "I-2", ticket_id: 6, mensagem: "feat: b" },
  ]);
  assert.deepEqual(ler(b, "SELECT * FROM arquivo_commit_demanda"), ler(b, "SELECT * FROM arquivo_commit"));
  assert.deepEqual(
    ler(
      b,
      "SELECT commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id FROM retrabalho_demanda ORDER BY rowid",
    ),
    [
      {
        commit_alterador: SHA_6,
        demanda_id: "I-1",
        ticket_id: 6,
        autor: null,
        ticket_origem_id: 3,
        linhas: 4,
        alterador_demanda_id: "I-2",
      },
      {
        commit_alterador: SHA_3,
        demanda_id: "I-1",
        ticket_id: 3,
        autor: null,
        ticket_origem_id: 4,
        linhas: 2,
        alterador_demanda_id: "I-1",
      },
      {
        commit_alterador: SHA_HUMANO,
        demanda_id: "I-1",
        ticket_id: null,
        autor: "Ana",
        ticket_origem_id: 3,
        linhas: 7,
        alterador_demanda_id: null,
      },
    ],
  );
});

test("CA-9, CA-10, CA-13, CA-18: dependências, em andamento, pendências e contagens do relatório", () => {
  const b = montarFixture();
  const r = backfillDemandas(b);
  assert.deepEqual(ler(b, "SELECT * FROM dependencia_demanda"), [{ demanda_id: "I-2", depende_demanda_id: "I-1" }]);
  assert.equal(b.prepare("SELECT 1 FROM demanda WHERE id = 'I-5'").get(), undefined);
  assert.deepEqual(r.naoMigradas, [{ issue: "I-5", motivo: "em andamento" }]);
  assert.deepEqual(r.dependenciasPendentes, [
    { de: "I-1", para: "I-5" },
    { de: "I-5", para: "I-1" },
  ]);
  assert.equal(r.antes.demanda, 0);
  assert.equal(r.depois.demanda, 4);
  assert.equal(r.depois.ticket_demanda, 9);
  assert.equal(r.depois.retrabalho_demanda, 3);
  assert.equal(r.depois.sessao, 0);
  assert.equal(Object.keys(r.depois).length, 17);
});

test("CA-12, CA-14: legado idêntico e rodar de novo não duplica nada", () => {
  const b = montarFixture();
  const antes = legado(b);
  const primeira = backfillDemandas(b);
  const migrado = novas(b);
  const segunda = backfillDemandas(b);
  assert.deepEqual(legado(b), antes);
  assert.deepEqual(novas(b), migrado);
  assert.deepEqual(segunda.antes, primeira.depois);
  assert.deepEqual(segunda.depois, primeira.depois);
});

for (const [nome, sql, erro] of [
  ["ticket aberto", "UPDATE ticket SET status = 'aberto', concluido_em = NULL WHERE id = 6", /I-2.*ticket 6.*aberto/],
  ["mais de 2 devoluções", "UPDATE ticket SET devolucoes = 3 WHERE id = 3", /I-1.*3 devolução/],
  [
    "sem ticket de desenvolvimento",
    "DELETE FROM arquivo_commit WHERE sha = '" +
      SHA_6 +
      "'; DELETE FROM retrabalho WHERE ticket = 6; DELETE FROM commit_ticket WHERE ticket = 6; UPDATE ticket SET etapa = 'revisao' WHERE id = 6",
    /I-2 não tem ticket de desenvolvimento/,
  ],
  [
    "retrabalho de alterador em andamento",
    "INSERT INTO retrabalho VALUES ('" + "7".repeat(40) + "', 10, NULL, 3, 1)",
    /I-1 não pôde ser migrada/,
  ],
] as const) {
  test(`CA-11: ${nome} recusa citando a issue e desfaz tudo`, () => {
    const b = montarFixture();
    b.exec(sql);
    const antes = novas(b);
    assert.throws(
      () => backfillDemandas(b),
      (e) => e instanceof ErroDeRegra && erro.test(e.message),
    );
    assert.deepEqual(novas(b), antes);
    assert.equal(b.isTransaction, false);
  });
}

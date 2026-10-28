import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { backfillDemandas } from "./backfill_demanda.ts";
import { montarFixture, SHA_ARQ_A, SHA_ARQ_Z } from "./fixture_backfill.test.ts";

const ler = (b: DatabaseSync, sql: string) =>
  b
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));
const NOVAS = [
  "sessao",
  "execucao_sessao",
  "uso_modelo_execucao",
  "uso_modelo_historico",
  "evidencia_demanda",
  "evidencia_historico",
  "arquivo_evidencia",
];
const novas = (b: DatabaseSync) => NOVAS.map((t) => ler(b, `SELECT * FROM ${t} ORDER BY rowid`));

test("CA-7: sessão por sessao_pi com modo da primeira execução; execuções ligadas à sessão do ticket", () => {
  const b = montarFixture();
  backfillDemandas(b);
  assert.deepEqual(ler(b, "SELECT * FROM sessao ORDER BY id"), [
    { id: "pi-2", demanda_id: "I-1", ticket_id: 2, modo: "interativo", conversa_referencia: "pi-2" },
    { id: "pi-3", demanda_id: "I-1", ticket_id: 3, modo: "autonomo", conversa_referencia: "pi-3" },
    { id: "pi-6", demanda_id: "I-2", ticket_id: 6, modo: "autonomo", conversa_referencia: "pi-6" },
  ]);
  const t = (id: string) => ler(b, `SELECT * FROM execucao_sessao WHERE id = '${id}'`)[0];
  assert.deepEqual(t("E-2"), {
    id: "E-2",
    sessao_id: "pi-3",
    inicio: "2026-01-04T00:00:00.000Z",
    fim: "2026-01-04T00:00:00.000Z",
    falha: 1,
    grupo_processo: 4242,
    erro: "caiu",
    modelo_provedor: "anthropic",
    modelo_nome: "sonnet",
    effort: null,
  });
  assert.equal(t("E-1")?.grupo_processo, null); // pgid_pi = 0
  assert.equal(t("E-3")?.sessao_id, "pi-3");
  assert.deepEqual([t("E-4")?.fim, t("E-4")?.falha], [null, 0]);
  assert.equal(t("E-5"), undefined); // issue em andamento fica de fora
});

test("CA-7: custo desconhecido vira NULL, custo conhecido é mantido, chamadas vão para o histórico", () => {
  const b = montarFixture();
  backfillDemandas(b);
  assert.deepEqual(
    ler(
      b,
      "SELECT execucao_id e, modelo_nome m, tokens_entrada i, tokens_saida o, tokens_cache_leitura r, tokens_cache_escrita w, custo FROM uso_modelo_execucao ORDER BY e, m",
    ),
    [
      { e: "E-1", m: "opus", i: 100, o: 50, r: 10, w: 5, custo: null },
      { e: "E-2", m: "haiku", i: 0, o: 0, r: 0, w: 0, custo: 0 },
      { e: "E-2", m: "sonnet", i: 200, o: 80, r: 0, w: 0, custo: 0.5 },
    ],
  );
  assert.deepEqual(ler(b, "SELECT execucao_id e, modelo_nome m, chamadas FROM uso_modelo_historico ORDER BY e, m"), [
    { e: "E-1", m: "opus", chamadas: 3 },
    { e: "E-2", m: "haiku", chamadas: 1 },
    { e: "E-2", m: "sonnet", chamadas: 2 },
  ]);
});

test("CA-1, CA-8: pr_aberto mais recente vira da rodada 1; as demais evidências seguem o ticket, com histórico e anexos", () => {
  const b = montarFixture();
  backfillDemandas(b);
  assert.deepEqual(
    ler(b, "SELECT id, demanda_id d, rodada_id r, ticket_id t, tipo, dados, em FROM evidencia_demanda ORDER BY id"),
    [
      {
        id: "evidencia-1",
        d: "I-1",
        r: null,
        t: 2,
        tipo: "desenho_solucao",
        dados: '{"a":1}',
        em: "2026-01-03T00:00:00.000Z",
      },
      {
        id: "evidencia-2",
        d: "I-1",
        r: null,
        t: 3,
        tipo: "pr_aberto",
        dados: '{"n":1}',
        em: "2026-01-06T00:00:00.000Z",
      },
      {
        id: "evidencia-3",
        d: "I-1",
        r: 1,
        t: null,
        tipo: "pr_aberto",
        dados: '{"n":2}',
        em: "2026-01-09T00:00:00.000Z",
      },
      { id: "evidencia-4", d: "I-2", r: 1, t: null, tipo: "pr_aberto", dados: "{}", em: "2026-01-08T00:00:00.000Z" },
      {
        id: "evidencia-5",
        d: "I-3",
        r: null,
        t: 8,
        tipo: "desenho_solucao",
        dados: "{}",
        em: "2026-01-04T00:00:00.000Z",
      },
    ],
  );
  assert.deepEqual(
    ler(
      b,
      "SELECT * FROM evidencia_historico WHERE evidencia_id IN ('evidencia-1','evidencia-3','evidencia-5') ORDER BY 1",
    ),
    [
      { evidencia_id: "evidencia-1", aprovada: 1, produtor: "agente" },
      { evidencia_id: "evidencia-3", aprovada: 1, produtor: "fabriquinha" },
      { evidencia_id: "evidencia-5", aprovada: 0, produtor: "agente" },
    ],
  );
  assert.deepEqual(ler(b, "SELECT * FROM arquivo_evidencia"), [
    { evidencia_id: "evidencia-1", ordem: 1, caminho: "a.png", sha256: SHA_ARQ_A, mime: "image/png", bytes: 20 },
    { evidencia_id: "evidencia-1", ordem: 2, caminho: "z.png", sha256: SHA_ARQ_Z, mime: "image/png", bytes: 10 },
  ]);
});

test("CA-8: o backfill não mexe nos arquivos do armazenamento", () => {
  const raiz = mkdtempSync(join(tmpdir(), "bf-"));
  mkdirSync(join(raiz, "arquivos"));
  writeFileSync(join(raiz, "arquivos", SHA_ARQ_A), "x");
  const contar = () => readdirSync(join(raiz, "arquivos")).length;
  const antes = contar();
  backfillDemandas(montarFixture());
  assert.equal(contar(), antes);
});

test("CA-12: rodar de novo não duplica sessões, execuções, uso, evidências nem anexos", () => {
  const b = montarFixture();
  backfillDemandas(b);
  const migrado = novas(b);
  backfillDemandas(b);
  assert.deepEqual(novas(b), migrado);
});

test("CA-11: erro depois de gravar as sessões desfaz tudo, inclusive as tabelas novas", () => {
  const b = montarFixture();
  b.exec("UPDATE execucao SET modelo_provedor = '', modelo_nome = '' WHERE id = 2");
  const antes = novas(b);
  assert.throws(
    () => backfillDemandas(b),
    (e) => e instanceof ErroDeRegra && e.message.includes("I-1 não pôde ser migrada"),
  );
  assert.deepEqual(novas(b), antes);
});

// A migração que remove o fluxo legado (I-247), sobre um banco montado com o esquema anterior (versão 32): copia
// iterações e propostas para as tabelas da demanda e só então apaga as tabelas e as colunas legadas; recusa, sem
// apagar nada, o banco com issue sem demanda ou com iteração sem ticket da demanda.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

/** A versão da remoção do fluxo legado; as migrações seguintes têm teste próprio. */
const REMOCAO = 33;
const ANTERIOR = REMOCAO - 1;
const T = "'2026-01-01T00:00:00.000Z'";
const LEGADAS = [
  "issue",
  "issue_dep",
  "ticket",
  "comando",
  "execucao",
  "decisao",
  "evidencia",
  "evidencia_arquivo",
  "commit_ticket",
  "arquivo_commit",
  "uso",
  "retrabalho",
  "proposta_issue",
  "iteracao",
];

const ler = (b: DatabaseSync, sql: string) =>
  b
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));
const contar = (b: DatabaseSync, tabela: string) => Number(b.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n);
const tabelas = (b: DatabaseSync) =>
  ler(b, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((l) => String(l.name));
const versao = (b: DatabaseSync) => Number(b.prepare("PRAGMA user_version").get()?.user_version);

/**
 * O banco da versão anterior como o cutover (I-245) o deixou: as issues 1 e 2 já migradas para as demandas I-1 e I-2,
 * o T-1 da I-1 com duas iterações e duas propostas (a aceita criou a I-2) e o T-2 da I-2 com uma iteração. O retrabalho
 * do T-2 sobre o T-1 o cutover já copiou; o do commit humano, gravado depois dele, só o legado tem.
 */
function bancoAnterior(): DatabaseSync {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, ANTERIOR));
  b.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, preparacao, testes, sonar_project_key, fitness, modelos, efforts, link_produto)
      VALUES ('p', '/repo/p', 'main', 'github', '["npm ci"]', '["t"]', 'chave', '[{"nome":"f"}]', '{}', '{}', 'https://p.exemplo.com');
    UPDATE configuracao SET auditoria_provedor = 'anthropic', auditoria_modelo = 'm';
    INSERT INTO varredura_base VALUES ('p', '${"a".repeat(40)}', ${T});
    INSERT INTO sequencia (nome, valor) VALUES ('issue', 2), ('ticket', 2), ('proposta', 2);
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'p', 't', 'problema', 'registro', ${T});
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (2, 'p', 'u', 'problema', 'registro', ${T});
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES (1, 1, 'registro', 't', 'aberto', 'auditor', ${T});
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES (2, 2, 'registro', 'u', 'aberto', 'auditor', ${T});
    INSERT INTO iteracao (id, ticket, tipo, em) VALUES (1, 1, 'mensagem', ${T}), (2, 1, 'reabertura', ${T}), (3, 2, 'dialogo', ${T});
    INSERT INTO proposta_issue (id, ticket, titulo, mensagem, arquivos, status, em) VALUES (1, 1, 'pt', 'pm', 3, 'pendente', ${T});
    INSERT INTO proposta_issue (id, ticket, titulo, mensagem, arquivos, status, issue_criada, em, decidida_em)
      VALUES (2, 1, 'at', 'am', 4, 'aceita', 2, ${T}, ${T});
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO demanda VALUES ('I-2', 'p', 'u', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-2');
    INSERT INTO demanda_historico (demanda_id, criada_em) VALUES ('I-1', ${T}), ('I-2', ${T});
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T}), ('I-2', 2, 'implementar', 'aberto', ${T});
    INSERT INTO retrabalho VALUES ('${"c".repeat(40)}', NULL, 'Ana', 1, 3), ('${"d".repeat(40)}', 2, NULL, 1, 2);
    INSERT INTO retrabalho_demanda VALUES ('${"d".repeat(40)}', 'I-1', 2, NULL, 1, 2, 'I-2');
  `);
  return b;
}

test("CA-8: copia iterações, propostas e o retrabalho que faltava para a demanda, e só então apaga o legado", () => {
  const b = bancoAnterior();
  const ficam = ["demanda", "demanda_historico", "ticket_demanda", "sequencia", "varredura_base", "configuracao"];
  const antes = Object.fromEntries(ficam.map((t) => [t, ler(b, `SELECT * FROM ${t}`)]));

  migrar(b, MIGRACOES.slice(0, REMOCAO));

  assert.equal(versao(b), REMOCAO);
  assert.deepEqual(ler(b, "SELECT * FROM iteracao_demanda ORDER BY id"), [
    { id: 1, demanda_id: "I-1", ticket_id: 1, tipo: "mensagem", em: "2026-01-01T00:00:00.000Z" },
    { id: 2, demanda_id: "I-1", ticket_id: 1, tipo: "reabertura", em: "2026-01-01T00:00:00.000Z" },
    { id: 3, demanda_id: "I-2", ticket_id: 2, tipo: "dialogo", em: "2026-01-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(ler(b, "SELECT * FROM proposta_demanda ORDER BY id"), [
    {
      id: 1,
      demanda_id: "I-1",
      ticket_id: 1,
      titulo: "pt",
      mensagem: "pm",
      arquivos: 3,
      status: "pendente",
      demanda_criada_id: null,
      em: "2026-01-01T00:00:00.000Z",
      decidida_em: null,
    },
    {
      id: 2,
      demanda_id: "I-1",
      ticket_id: 1,
      titulo: "at",
      mensagem: "am",
      arquivos: 4,
      status: "aceita",
      demanda_criada_id: "I-2",
      em: "2026-01-01T00:00:00.000Z",
      decidida_em: "2026-01-01T00:00:00.000Z",
    },
  ]);
  assert.deepEqual(ler(b, "SELECT * FROM retrabalho_demanda ORDER BY commit_alterador"), [
    {
      commit_alterador: "c".repeat(40),
      demanda_id: "I-1",
      ticket_id: null,
      autor: "Ana",
      ticket_origem_id: 1,
      linhas: 3,
      alterador_demanda_id: null,
    },
    {
      commit_alterador: "d".repeat(40),
      demanda_id: "I-1",
      ticket_id: 2,
      autor: null,
      ticket_origem_id: 1,
      linhas: 2,
      alterador_demanda_id: "I-2",
    },
  ]);
  for (const legada of LEGADAS) assert.ok(!tabelas(b).includes(legada), legada);
  for (const tabela of ficam) assert.deepEqual(ler(b, `SELECT * FROM ${tabela}`), antes[tabela], tabela);
  assert.deepEqual(ler(b, "SELECT * FROM projeto"), [
    {
      nome: "p",
      repo: "/repo/p",
      branch_base: "main",
      hospedagem: "github",
      preparacao: '["npm ci"]',
      sonar_project_key: "chave",
      link_produto: "https://p.exemplo.com",
      cursor_commit_humano: null,
    },
  ]);
  assert.deepEqual(ler(b, "PRAGMA foreign_key_check"), []);
  // As tabelas novas recusam a proposta aceita sem demanda criada e a iteração de ticket que não existe.
  assert.throws(() => {
    b.exec(`INSERT INTO proposta_demanda (demanda_id, ticket_id, titulo, mensagem, arquivos, status, em, decidida_em)
      VALUES ('I-1', 1, 't', 'm', 0, 'aceita', ${T}, ${T})`);
  }, /CHECK/);
  assert.throws(() => {
    b.exec(`INSERT INTO iteracao_demanda (demanda_id, ticket_id, tipo, em) VALUES ('I-1', 9, 'mensagem', ${T})`);
  }, /FOREIGN KEY/);
  b.close();
});

test("copia o modelo e o effort de cada etapa legada para as etapas do ticket, só no projeto sem nenhuma etapa", () => {
  const b = bancoAnterior();
  const opus = '{"provedor":"anthropic","modelo":"claude-opus-5-5"}';
  b.exec(`
    UPDATE projeto SET
      modelos = '{"registro":${opus},"desenvolvimento":{"provedor":"llamacpp","modelo":"qwen"},"sessao":${opus}}',
      efforts = '{"desenho":"high","revisao":"low","encerramento":"max"}'
    WHERE nome = 'p';
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, preparacao, testes, sonar_project_key, fitness, modelos, efforts)
      VALUES ('q', '/repo/q', 'main', 'github', '[]', '["t"]', 'q', '[{"nome":"f"}]', '{"desenho":${opus}}', '{"revisao":"high"}');
    INSERT INTO configuracao_etapa_projeto (projeto, etapa, effort) VALUES ('q', 'implementar', 'off');
  `);

  migrar(b, MIGRACOES.slice(0, REMOCAO));

  const opusNovo = { modelo_provedor: "anthropic", modelo_nome: "claude-opus-5-5" };
  const sem = { modelo_provedor: null, modelo_nome: null };
  assert.deepEqual(ler(b, "SELECT * FROM configuracao_etapa_projeto ORDER BY projeto, etapa"), [
    { projeto: "p", etapa: "demanda", ...opusNovo, effort: null },
    { projeto: "p", etapa: "encerrar_demanda", ...sem, effort: "max" },
    { projeto: "p", etapa: "encerrar_rodada", ...sem, effort: "max" },
    { projeto: "p", etapa: "implementar", modelo_provedor: "llamacpp", modelo_nome: "qwen", effort: null },
    { projeto: "p", etapa: "planejar", ...sem, effort: "high" },
    { projeto: "p", etapa: "resolver_conflito", modelo_provedor: "llamacpp", modelo_nome: "qwen", effort: null },
    { projeto: "p", etapa: "revisar_demanda", ...sem, effort: "low" },
    { projeto: "p", etapa: "revisar_rodada", ...sem, effort: "low" },
    { projeto: "p", etapa: "sessao_em_aberto", ...opusNovo, effort: null },
    // O projeto que já tinha etapa configurada fica como estava.
    { projeto: "q", etapa: "implementar", ...sem, effort: "off" },
  ]);
  b.close();
});

test("CA-9: issue sem demanda recusa a migração, citando a issue e orientando a versão anterior, sem apagar nada", () => {
  const b = bancoAnterior();
  b.exec(
    `INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (7, 'p', 'v', 'problema', 'registro', ${T})`,
  );
  const antes = LEGADAS.map((t) => contar(b, t));

  assert.throws(
    () => {
      migrar(b, MIGRACOES.slice(0, REMOCAO));
    },
    new ErroDeRegra(
      "I-7 sem demanda correspondente: esta versão apaga o fluxo legado e não migra mais issues",
      "suba a versão anterior da Fabriquinha, que migra as issues para demandas na subida, e depois esta de novo",
    ),
  );
  assert.equal(versao(b), ANTERIOR);
  assert.deepEqual(
    LEGADAS.map((t) => contar(b, t)),
    antes,
  );
  assert.ok(!tabelas(b).includes("iteracao_demanda"));
  assert.equal(ler(b, "PRAGMA foreign_keys")[0]?.foreign_keys, 1);
  b.close();
});

test("iteração de ticket legado sem ticket da demanda: a contagem não bate e a migração é desfeita", () => {
  const b = bancoAnterior();
  b.exec("DELETE FROM retrabalho_demanda; DELETE FROM retrabalho WHERE ticket = 2");
  b.exec("DELETE FROM ticket_demanda WHERE demanda_id = 'I-2'");

  assert.throws(
    () => {
      migrar(b, MIGRACOES.slice(0, REMOCAO));
    },
    new ErroDeRegra(
      "a migração copiou 2 das 3 linhas de iteracao: há ticket legado sem ticket da demanda",
      "restaure o banco do backup e relate o problema",
    ),
  );
  assert.equal(versao(b), ANTERIOR);
  assert.equal(contar(b, "iteracao"), 3);
  assert.ok(!tabelas(b).includes("iteracao_demanda"));
  b.close();
});

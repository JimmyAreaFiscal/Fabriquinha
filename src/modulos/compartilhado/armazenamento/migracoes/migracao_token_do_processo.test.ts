import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "../banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 13;
const EM = "2026-01-01T00:00:00.000Z";

const linhas = (banco: DatabaseSync, sql: string): Record<string, unknown>[] =>
  banco
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

/** Um banco na versão 49, com dois processos terminados e um ainda em voo. */
function bancoNaVersao49(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE));
  banco.exec(`
    PRAGMA foreign_keys = ON;
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
      VALUES ('I-1', 'loja', 'T', 'funcionalidade', 'D', 'em_execucao', '${EM}', 'claude', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES ('I-1', 1, 'implementar', 'em_execucao', '${EM}');
    INSERT INTO trabalho_agentico VALUES ('s-1', 'I-1', 1, 'autonomo', 'c');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('p-1', 's-1', '${EM}', '${EM}', 0);
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('p-2', 's-1', '${EM}', '${EM}', 1);
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha, grupo_processo) VALUES ('p-3', 's-1', '${EM}', NULL, 0, 4321);
  `);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  return banco;
}

test("a migração 50 acrescenta o hash do token sem perder linha, com o hash nulo nos processos que existem", () => {
  const banco = bancoNaVersao49();
  const processosAntes = linhas(banco, "SELECT * FROM processo_do_trabalho ORDER BY id");

  migrar(banco, MIGRACOES);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES + 1);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(
    linhas(banco, "SELECT * FROM processo_do_trabalho ORDER BY id"),
    processosAntes.map((p) => ({ ...p, hash_do_token: null })),
  );
  banco.close();
});

test("o hash do token é único entre os processos e, nulo, pode repetir", () => {
  const banco = bancoNaVersao49();
  migrar(banco, MIGRACOES);
  const hash = "a".repeat(64);

  banco.prepare("UPDATE processo_do_trabalho SET hash_do_token = ? WHERE id = 'p-1'").run(hash);
  assert.throws(() => {
    banco.prepare("UPDATE processo_do_trabalho SET hash_do_token = ? WHERE id = 'p-2'").run(hash);
  }, /UNIQUE/);
  assert.equal(linhas(banco, "SELECT id FROM processo_do_trabalho WHERE hash_do_token IS NULL").length, 2);
  banco.close();
});

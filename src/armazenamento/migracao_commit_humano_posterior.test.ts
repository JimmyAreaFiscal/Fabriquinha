import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 12;
const EM = "2026-01-01T00:00:00.000Z";
const SHA = (n: number) => String(n).padStart(40, "a");

const linhas = (banco: DatabaseSync, sql: string): Record<string, unknown>[] =>
  banco
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

/** Um banco na versão 48 com uma linha de ticket (`ticket_id` preenchido) e uma humana (`ticket_id` nulo, com `autor`). */
function bancoNaVersao48(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE));
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
      VALUES ('I-1', 'loja', 'T', 'funcionalidade', 'D', 'em_execucao', '${EM}', 'claude', 's', 1, 'fabriquinha/I-1');
    INSERT INTO rodada (demanda_id, rodada_id, titulo, estado, estado_alterado_em, e2e, branch)
      VALUES ('I-1', 1, 'R', 'implementar', '${EM}', 0, 'fabriquinha/I-1-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
      VALUES ('I-1', 1, 'implementar', 'concluido', '${EM}', 1), ('I-1', 2, 'implementar', 'concluido', '${EM}', 1);
    INSERT INTO retrabalho_demanda VALUES ('${SHA(1)}', 'I-1', 2, NULL, 1, 7, 'I-1');
    INSERT INTO retrabalho_demanda VALUES ('${SHA(2)}', 'I-1', NULL, 'ana', 1, 3, NULL);
  `);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  return banco;
}

const COLUNAS = "SELECT name FROM pragma_table_info('NOME') ORDER BY cid";

test("a 49 renomeia a tabela e os índices, com as mesmas colunas e o mesmo conteúdo", () => {
  const banco = bancoNaVersao48();
  const colunasAntes = linhas(banco, COLUNAS.replace("NOME", "retrabalho_demanda"));
  const conteudoAntes = linhas(banco, "SELECT * FROM retrabalho_demanda ORDER BY commit_alterador");

  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES + 1 - VERSAO_LINHA_DE_BASE));

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES + 1);
  assert.deepEqual(linhas(banco, COLUNAS.replace("NOME", "commit_humano_posterior")), colunasAntes);
  assert.deepEqual(linhas(banco, "SELECT * FROM commit_humano_posterior ORDER BY commit_alterador"), conteudoAntes);
  assert.equal(conteudoAntes.length, 2);
  assert.deepEqual(linhas(banco, "SELECT name FROM sqlite_master WHERE name = 'retrabalho_demanda'"), []);
  assert.deepEqual(
    linhas(
      banco,
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ix_%posterior%' ORDER BY name",
    ),
    [
      { name: "ix_commit_humano_posterior_alterador", tbl_name: "commit_humano_posterior" },
      { name: "ix_commit_humano_posterior_origem", tbl_name: "commit_humano_posterior" },
    ],
  );
  assert.deepEqual(
    linhas(
      banco,
      "SELECT name FROM sqlite_master WHERE name IN ('ix_retrabalho_demanda_origem', 'ix_retrabalho_demanda_alterador')",
    ),
    [],
  );
  assert.deepEqual(linhas(banco, "PRAGMA foreign_key_check"), []);
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const TABELAS_TOCADAS = [
  "demanda",
  "ticket_demanda",
  "decisao_ticket",
  "decisao_ticket_historico",
  "evidencia_demanda",
];
const EM = "2026-01-01T00:00:00.000Z";

/** Um banco na v36 com duas demandas de ferramentas diferentes e decisões de Auditor e de Agente (com e sem execução). */
function bancoNaVersao36(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key) VALUES ('loja', '/r', 'main', 'github', 'k');
    INSERT INTO demanda VALUES
      ('I-1', 'loja', 't', 'problema', 'd', 'execucao', '${EM}', 'claude', 's1', 1, 'fabriquinha/I-1'),
      ('I-2', 'loja', 't', 'problema', 'd', 'execucao', '${EM}', 'claude', 's2', 1, 'fabriquinha/I-2'),
      ('I-3', 'loja', 't', 'problema', 'd', 'execucao', '${EM}', 'avaliacao', 'a#1', 1, 'fabriquinha/I-3');
    INSERT INTO rodada VALUES ('I-1', 1, 'r', 'desenvolvimento', 0, 'fabriquinha/I-1-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id) VALUES
      ('I-1', 1, 'implementar', 'concluido', '${EM}', 1),
      ('I-1', 2, 'implementar', 'concluido', '${EM}', 1),
      ('I-1', 3, 'implementar', 'concluido', '${EM}', 1);
    INSERT INTO sessao VALUES ('sessao-1', 'I-1', 1, 'autonomo', 'c1'), ('sessao-2', 'I-1', 2, 'autonomo', 'c2');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, falha) VALUES
      ('exec-velha', 'sessao-1', '2026-01-01T01:00:00.000Z', 0),
      ('exec-nova', 'sessao-1', '2026-01-01T02:00:00.000Z', 0),
      ('exec-outra', 'sessao-2', '2026-01-01T03:00:00.000Z', 0);
    INSERT INTO decisao_ticket VALUES
      ('I-1', 1, 1, 'recusado', NULL, 'faltou teste', 'agente', '${EM}'),
      ('I-1', 1, 2, 'aprovado', 5, NULL, 'auditor', '${EM}'),
      ('I-1', 2, 1, 'aprovado', NULL, NULL, 'agente', '${EM}'),
      ('I-1', 3, 1, 'aprovado', NULL, NULL, 'agente', '${EM}');
    INSERT INTO decisao_ticket_historico VALUES ('I-1', 1, 2, 'revisao');
    INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, tipo, dados, em) VALUES ('e1', 'I-1', 1, 'plano', '{}', '${EM}');
    INSERT INTO evidencia_demanda (id, demanda_id, ticket_id, tipo, dados, em) VALUES ('e2', 'I-1', 1, 'plano', '{}', '${EM}');
  `);
  return banco;
}

const contagens = (banco: DatabaseSync) =>
  Object.fromEntries(
    TABELAS_TOCADAS.map((tabela) => [tabela, banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n]),
  );

test("a migração 37 troca as colunas de autoria sem perder nem inventar linhas", () => {
  const banco = bancoNaVersao36();
  const demandasAntes = banco
    .prepare("SELECT origem_ferramenta AS ferramenta, count(*) AS n FROM demanda GROUP BY 1 ORDER BY 1")
    .all()
    .map((linha) => ({ ...linha }));
  const contagensAntes = contagens(banco);

  migrar(banco, MIGRACOES);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_LINHA_DE_BASE + 1);
  const demandasDepois = banco
    .prepare("SELECT criada_por_ferramenta AS ferramenta, count(*) AS n FROM demanda GROUP BY 1 ORDER BY 1")
    .all()
    .map((linha) => ({ ...linha }));
  assert.deepEqual(demandasDepois, demandasAntes);
  assert.equal(banco.prepare("SELECT criada_por_sessao AS s FROM demanda WHERE id = 'I-3'").get()?.s, "a#1");

  assert.equal(
    banco.prepare("SELECT count(*) AS n FROM ticket_demanda WHERE criado_por_tipo <> 'fabriquinha'").get()?.n,
    0,
  );
  assert.equal(
    banco.prepare("SELECT count(*) AS n FROM ticket_demanda WHERE criado_por_trabalho_id IS NOT NULL").get()?.n,
    0,
  );

  const decisoes = banco
    .prepare("SELECT ticket_id, decisao_id, por_tipo, por_trabalho_id FROM decisao_ticket ORDER BY rowid")
    .all()
    .map((linha) => ({ ...linha }));
  assert.deepEqual(decisoes, [
    { ticket_id: 1, decisao_id: 1, por_tipo: "agente", por_trabalho_id: "exec-nova" },
    { ticket_id: 1, decisao_id: 2, por_tipo: "auditor", por_trabalho_id: null },
    { ticket_id: 2, decisao_id: 1, por_tipo: "agente", por_trabalho_id: "exec-outra" },
    { ticket_id: 3, decisao_id: 1, por_tipo: "agente", por_trabalho_id: null },
  ]);

  const evidencias = banco
    .prepare("SELECT DISTINCT autor_tipo, autor_trabalho_id, autor_ferramenta, autor_sessao FROM evidencia_demanda")
    .all()
    .map((linha) => ({ ...linha }));
  assert.deepEqual(evidencias, [
    { autor_tipo: "fabriquinha", autor_trabalho_id: null, autor_ferramenta: null, autor_sessao: null },
  ]);

  assert.deepEqual(contagens(banco), contagensAntes);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  banco.close();
});

test("depois da migração 37 o banco recusa autoria incoerente", () => {
  const banco = bancoNaVersao36();
  migrar(banco, MIGRACOES);
  const recusa = (sql: string) => {
    assert.throws(() => {
      banco.exec(sql);
    });
  };
  recusa("UPDATE ticket_demanda SET criado_por_tipo = 'agente'");
  recusa("UPDATE ticket_demanda SET criado_por_trabalho_id = 'exec-nova'");
  recusa("UPDATE decisao_ticket SET por_tipo = 'externo'");
  recusa("UPDATE evidencia_demanda SET autor_ferramenta = 'claude'");
  banco.exec("UPDATE decisao_ticket SET por_tipo = 'fabriquinha', por_trabalho_id = NULL");
  banco.exec("UPDATE evidencia_demanda SET autor_tipo = 'externo', autor_ferramenta = 'claude', autor_sessao = 's1'");
  banco.close();
});

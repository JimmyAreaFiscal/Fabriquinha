import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "../banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 7;
const EM = "2026-01-01T00:00:00.000Z";
const MOTIVO = "(evidência recusada antes da migração 44)";

const linhas = (banco: DatabaseSync, sql: string): Record<string, unknown>[] =>
  banco
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

const contar = (banco: DatabaseSync, tabela: string): number =>
  Number(banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n);

/**
 * Um banco na versão 43. A I-1 tem a rodada 1 com os tickets 1 e 2; o ticket 1 já tem uma Tentativa. Evidências do
 * ticket 1: `plano` com `aprovada` true (e um anexo), `execucao_testes` com false (e um anexo) e `relatorio_sonar` sem a
 * chave. A rodada 1 tem uma `pr_aberto` com false, sem ticket. A I-2 não tem ticket.
 */
function bancoNaVersao43(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE));
  const demanda = (id: string) =>
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
       VALUES ('${id}', 'loja', 'T', 'funcionalidade', 'D', 'em_execucao', '${EM}', 'claude', 's', 1, 'fabriquinha/${id}');`;
  const ticket = (id: number) =>
    `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
       VALUES ('I-1', ${String(id)}, 'implementar', 'concluido', '${EM}', 1);`;
  const evidencia = (id: string, dono: string, tipo: string, dados: string) =>
    `INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES ('${id}', 'I-1', ${dono}, '${tipo}', '${dados}', '${EM}');`;
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    ${demanda("I-1")} ${demanda("I-2")}
    INSERT INTO rodada (demanda_id, rodada_id, titulo, estado, estado_alterado_em, e2e, branch)
      VALUES ('I-1', 1, 'R', 'implementar', '${EM}', 0, 'fabriquinha/I-1-1');
    ${ticket(1)} ${ticket(2)}
    INSERT INTO tentativa (demanda_id, ticket_id, numero, inicio, fim, resultado_tipo, motivo)
      VALUES ('I-1', 1, 1, '${EM}', '${EM}', 'reprovacao', 'antiga');
    ${evidencia("e-plano", "NULL, 1", "plano", '{"aprovada":true,"texto":"a"}')}
    ${evidencia("e-testes", "NULL, 1", "execucao_testes", '{"aprovada":false,"passou":false}')}
    ${evidencia("e-sonar", "NULL, 1", "relatorio_sonar", '{"nota":"A"}')}
    ${evidencia("e-pr", "1, NULL", "pr_aberto", '{"aprovada":false,"id":"7"}')}
    INSERT INTO arquivo_evidencia (evidencia_id, ordem, caminho, sha256, mime, bytes) VALUES ('e-plano', 1, '/a/plano.md', 'x', 'text/markdown', 1);
    INSERT INTO arquivo_evidencia (evidencia_id, ordem, caminho, sha256, mime, bytes) VALUES ('e-testes', 1, '/a/saida.txt', 'y', 'text/plain', 2);
    INSERT INTO evidencia_historico (evidencia_id, aprovada, produtor) VALUES ('e-testes', 0, 'fabriquinha');
  `);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  return banco;
}

test("a migração 44 troca cada evidência recusada por uma Tentativa e tira aprovada dos dados", () => {
  const banco = bancoNaVersao43();
  const evidenciasAntes = contar(banco, "evidencia_demanda");
  const tentativasAntes = contar(banco, "tentativa");
  migrar(banco, MIGRACOES);

  assert.equal(evidenciasAntes, 4);
  assert.equal(evidenciasAntes, contar(banco, "evidencia_demanda") + (contar(banco, "tentativa") - tentativasAntes));
  assert.deepEqual(linhas(banco, "SELECT id, dados FROM evidencia_demanda ORDER BY rowid"), [
    { id: "e-plano", dados: '{"texto":"a"}' },
    { id: "e-sonar", dados: '{"nota":"A"}' },
  ]);
  assert.equal(linhas(banco, "SELECT 1 FROM evidencia_demanda WHERE dados LIKE '%aprovada%'").length, 0);

  const novas = linhas(
    banco,
    "SELECT ticket_id, numero, inicio, fim, resultado_tipo, causa, motivo, migrada, submissao FROM tentativa WHERE numero > 1 OR ticket_id = 2 ORDER BY ticket_id, numero",
  ).map((t) => ({ ...t, submissao: JSON.parse(String(t.submissao)) as unknown }));
  assert.deepEqual(novas, [
    {
      ticket_id: 1,
      numero: 2,
      inicio: EM,
      fim: EM,
      resultado_tipo: "reprovacao",
      causa: null,
      motivo: MOTIVO,
      migrada: 1,
      submissao: {
        tipo: "execucao_testes",
        dono: { demanda_id: "I-1", ticket_id: 1 },
        produtor: { tipo: "fabriquinha" },
        dados: { passou: false },
        anexos: ["/a/saida.txt"],
      },
    },
    {
      // a evidência da rodada, sem ticket, vai para o último ticket dela
      ticket_id: 2,
      numero: 1,
      inicio: EM,
      fim: EM,
      resultado_tipo: "reprovacao",
      causa: null,
      motivo: MOTIVO,
      migrada: 1,
      submissao: {
        tipo: "pr_aberto",
        dono: { demanda_id: "I-1", rodada_id: 1 },
        produtor: { tipo: "fabriquinha" },
        dados: { id: "7" },
        anexos: [],
      },
    },
  ]);
  assert.deepEqual(linhas(banco, "SELECT evidencia_id FROM arquivo_evidencia"), [{ evidencia_id: "e-plano" }]);
  assert.equal(contar(banco, "evidencia_historico"), 0);
  assert.equal(linhas(banco, "PRAGMA foreign_key_check").length, 0);
});

test("a migração 44 não duplica ao rodar de novo", () => {
  const banco = bancoNaVersao43();
  migrar(banco, MIGRACOES);
  const tentativas = contar(banco, "tentativa");
  migrar(banco, MIGRACOES);
  assert.equal(contar(banco, "tentativa"), tentativas);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_LINHA_DE_BASE + MIGRACOES.length);
});

test("a migração 44 recusa a evidência recusada de uma demanda sem ticket e desfaz tudo", () => {
  const banco = bancoNaVersao43();
  banco.exec(
    `INSERT INTO evidencia_demanda (id, demanda_id, tipo, dados, em) VALUES ('e-sem-ticket', 'I-2', 'plano', '{"aprovada":false}', '${EM}')`,
  );
  assert.throws(() => {
    migrar(banco, MIGRACOES);
  }, /e-sem-ticket/);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  assert.equal(contar(banco, "evidencia_demanda"), 5);
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { demandasParaDespacho, ocupacaoDoLimite, retomadasDePlanejamento } from "./despacho_demanda.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const DEPOIS = "'2026-01-02T00:00:00.000Z'";

const banco = () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
    VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]')`);
  return b;
};
const demanda = (b: DatabaseSync, id: string, fase: string) => {
  b.exec(
    `INSERT INTO demanda VALUES ('${id}', 'p', 't', 'problema', 'd', '${fase}', ${T}, 'f', 's', 1, 'fabriquinha/${id}')`,
  );
};
const rodada = (b: DatabaseSync, id: string, fase: string) => {
  b.exec(`INSERT INTO rodada VALUES ('${id}', 1, 'r', '${fase}', 0, 'fabriquinha/${id}-1')`);
};
const ticket = (b: DatabaseSync, id: string, n: number, etapa: string, status: string, rodadaId?: number) => {
  b.exec(
    `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id)
     VALUES ('${id}', ${String(n)}, '${etapa}', '${status}', ${T}, ${rodadaId === undefined ? "NULL" : String(rodadaId)})`,
  );
};
const decisao = (b: DatabaseSync, id: string, n: number, decisaoId: number, resultado: string) => {
  b.exec(
    `INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, resultado, motivo, por, em)
     VALUES ('${id}', ${String(n)}, ${String(decisaoId)}, '${resultado}', ${resultado === "recusado" ? "'m'" : "NULL"}, 'auditor', ${T})`,
  );
};
let execucoes = 0;
const execucao = (b: DatabaseSync, id: string, n: number, inicio: string, fim: string | null) => {
  const sessao = `S-${id}-${String(n)}`;
  b.exec(`INSERT OR IGNORE INTO sessao VALUES ('${sessao}', '${id}', ${String(n)}, 'autonomo', 'ref')`);
  b.exec(
    `INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('E-${String(++execucoes)}', '${sessao}', ${inicio}, ${fim ?? "NULL"}, 0)`,
  );
};

test("CA-1 a CA-6: lê só planejamento, execução, revisão e encerramento, com as predecessoras", () => {
  const b = banco();
  demanda(b, "I-4", "execucao");
  demanda(b, "I-6", "planejamento");
  demanda(b, "I-7", "revisao_demanda");
  demanda(b, "I-8", "encerramento");
  demanda(b, "I-9", "aprovacao_planejamento");
  b.exec("INSERT INTO dependencia_demanda VALUES ('I-6', 'I-4')");
  b.exec("INSERT INTO dependencia_demanda VALUES ('I-7', 'I-8')");
  const lidas = demandasParaDespacho(b).map((d) => [d.agregado.demanda.id, d.predecessoras_satisfeitas]);
  assert.deepEqual(lidas, [
    ["I-4", true],
    ["I-6", false],
    ["I-7", false],
    ["I-8", true],
  ]);
  assert.equal(b.isTransaction, false);
});

test("ocupação: conta em_execucao nas fases lidas e ignora gates humanos", () => {
  const b = banco();
  demanda(b, "I-1", "execucao");
  rodada(b, "I-1", "desenvolvimento");
  ticket(b, "I-1", 1, "implementar", "em_execucao", 1);
  ticket(b, "I-1", 2, "implementar", "aberto", 1);
  ticket(b, "I-1", 3, "sessao_em_aberto", "em_execucao", 1);
  demanda(b, "I-2", "execucao");
  rodada(b, "I-2", "aprovacao_pull_request");
  ticket(b, "I-2", 1, "encerrar_rodada", "em_execucao", 1);
  demanda(b, "I-3", "execucao");
  rodada(b, "I-3", "encerramento");
  ticket(b, "I-3", 1, "encerrar_rodada", "em_execucao", 1);
  demanda(b, "I-4", "encerramento");
  ticket(b, "I-4", 1, "encerrar_demanda", "em_execucao");
  assert.equal(ocupacaoDoLimite(b), 3); // I-1.T1, o encerrar_rodada de I-3 e o encerrar_demanda de I-4
});

test("retoma o planejar reprovado e só depois de uma recusa nova", () => {
  const b = banco();
  demanda(b, "I-1", "planejamento");
  ticket(b, "I-1", 1, "planejar", "em_execucao");
  execucao(b, "I-1", 1, "'2025-12-31T00:00:00.000Z'", T);
  assert.deepEqual(retomadasDePlanejamento(b), []); // sem recusa
  decisao(b, "I-1", 1, 1, "recusado");
  assert.deepEqual(retomadasDePlanejamento(b), ["I-1"]);
  execucao(b, "I-1", 1, DEPOIS, null); // retomada: o agente saiu sem submeter, não retoma em laço
  assert.deepEqual(retomadasDePlanejamento(b), []);
  b.exec(`UPDATE execucao_sessao SET fim = ${DEPOIS}`);
  assert.deepEqual(retomadasDePlanejamento(b), []);
  b.exec(`UPDATE decisao_ticket SET em = '2026-01-03T00:00:00.000Z'`); // recusa nova
  assert.deepEqual(retomadasDePlanejamento(b), ["I-1"]);
});

test("ocupação ignora o planejar reprovado sem execução aberta, mas conta o que roda", () => {
  const b = banco();
  demanda(b, "I-1", "planejamento");
  demanda(b, "I-2", "planejamento");
  ticket(b, "I-1", 1, "planejar", "em_execucao");
  ticket(b, "I-2", 1, "planejar", "em_execucao");
  execucao(b, "I-1", 1, T, T);
  execucao(b, "I-2", 1, T, null);
  assert.equal(ocupacaoDoLimite(b), 2);
  decisao(b, "I-1", 1, 1, "recusado");
  decisao(b, "I-2", 1, 1, "recusado");
  assert.equal(ocupacaoDoLimite(b), 1); // o de I-2 tem execução aberta
  decisao(b, "I-1", 1, 2, "aprovado");
  assert.equal(ocupacaoDoLimite(b), 2);
});

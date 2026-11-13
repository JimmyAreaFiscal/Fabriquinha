import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco_temporario.ts";
import { ticketsEmExecucaoDasEtapas } from "./itens_do_planejamento.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const T = "'2026-01-01T00:00:00.000Z'";
const ref = { demanda_id: "I-1", ticket_id: 1 };

const novoBanco = () => {
  const b = abrirBancoTemporario().banco;
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'funcionalidade', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T}), ('I-1', 2, 'implementar', 'aberto', ${T});`);
  return b;
};

test("tickets em execução das Etapas pedidas; ticket aberto ou de Etapa fora da lista não entram", () => {
  const b = novoBanco();
  const etapas = { sempre: ["implementar"] as const, noEstadoDaRodada: [] };
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), []);
  b.exec("UPDATE ticket_demanda SET estado = 'em_execucao' WHERE ticket_id = 1");
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), [ref]);
  b.exec("UPDATE ticket_demanda SET etapa = 'planejar' WHERE ticket_id = 1");
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), []);
});

test("o ticket da Etapa que conta no estado da rodada só entra com a rodada ainda no estado da Etapa", () => {
  const b = novoBanco();
  const etapas = { sempre: [], noEstadoDaRodada: ["encerrar_rodada"] as const };
  b.exec(`INSERT INTO rodada VALUES ('I-1', 1, 'r', 'encerrar_rodada', ${T}, 0, 'fabriquinha/I-1-1');
    UPDATE ticket_demanda SET estado = 'em_execucao', etapa = 'encerrar_rodada', rodada_id = 1 WHERE ticket_id = 1`);
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), [ref]);
  b.exec("UPDATE rodada SET estado = 'gate_pr'");
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), []);
});

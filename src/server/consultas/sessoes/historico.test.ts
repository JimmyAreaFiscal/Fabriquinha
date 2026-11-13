// A consulta do Histórico: o filtro de demanda é o endereço de uma demanda e a leitura não deixa transação aberta.
import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco_temporario.ts";
import { ErroDeRegra } from "../../../modulos/compartilhado/nucleo/erros.ts";
import { consultarHistorico } from "./historico.ts";

const T0 = "2026-10-11T12:00:00.000Z";

function cenario() {
  const { banco } = abrirBancoTemporario();
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r/loja', 'main', 'github', 'loja');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'loja', 'Timeout', 'problema', 'd', 'em_execucao', '${T0}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES ('I-1', 1, 'planejar', 'concluido', '${T0}');
    INSERT INTO trabalho_agentico VALUES ('s1', 'I-1', 1, 'autonomo', 'c1');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('x1', 's1', '${T0}', '${T0}', 0);
  `);
  return banco;
}

test("a demanda do filtro vale como I-1 ou 1; a outra não aparece", () => {
  const banco = cenario();
  const sessoes = (demanda: string) => consultarHistorico(banco, { escopo: "historico", demanda }).map((s) => s.sessao);
  assert.deepEqual(sessoes("I-1"), ["s1"]);
  assert.deepEqual(sessoes("1"), ["s1"]);
  assert.deepEqual(sessoes("I-2"), []);
  assert.equal(banco.isTransaction, false);
});

test("o endereço de rodada ou de ticket no filtro de demanda é ErroDeRegra", () => {
  const banco = cenario();
  for (const demanda of ["I-1.R1", "I-1.T1"]) {
    assert.throws(
      () => consultarHistorico(banco, { escopo: "historico", demanda }),
      (erro) => erro instanceof ErroDeRegra && erro.message.startsWith(`${demanda} não é o endereço de uma demanda`),
    );
  }
  assert.equal(banco.isTransaction, false);
});

test("sem demanda no filtro, todas as sessões do escopo", () => {
  const banco = cenario();
  const sessoes = (escopo: "ativas" | "historico") => consultarHistorico(banco, { escopo }).map((s) => s.sessao);
  assert.deepEqual(sessoes("historico"), ["s1"]);
  assert.deepEqual(sessoes("ativas"), []);
});

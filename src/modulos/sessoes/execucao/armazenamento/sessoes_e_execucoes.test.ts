import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  agregadoNoEstado,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { escopoDaExecucao } from "./sessoes_e_execucoes.ts";

test("escopoDaExecucao traz a sessão e o ticket da execução, aberta ou terminada, e nada da que não existe", () => {
  const { banco, fechar } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregadoNoEstado("I-1", "em_execucao"));
  const { trabalho_id } = abrirTrabalhoDoAgente(banco, { demanda_id: "I-1", ticket_id: 1 });
  const escopo = { sessao: `s-${trabalho_id}`, demanda_id: "I-1", ticket_id: 1 };
  assert.deepEqual(escopoDaExecucao(banco, trabalho_id), { fim: null, ...escopo });
  banco.prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = ?").run("2026-01-02T00:00:00.000Z", trabalho_id);
  assert.deepEqual(escopoDaExecucao(banco, trabalho_id), { fim: "2026-01-02T00:00:00.000Z", ...escopo });
  assert.equal(escopoDaExecucao(banco, "inexistente"), undefined);
  fechar();
});

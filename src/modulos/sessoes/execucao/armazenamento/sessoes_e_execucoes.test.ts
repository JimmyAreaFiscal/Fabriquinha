import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  agregadoNoEstado,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { resumosDasSessoesEmLote } from "./sessoes_e_execucoes.ts";

test("a lista pela execução traz a sessão e o ticket dela, aberta ou terminada, e nada da que não existe", () => {
  const { banco, fechar } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregadoNoEstado("I-1", "em_execucao"));
  const { trabalho_id } = abrirTrabalhoDoAgente(banco, { demanda_id: "I-1", ticket_id: 1 });
  const escopo = (fim: string | null) => {
    const [resumo] = resumosDasSessoesEmLote(banco, { execucoes: [trabalho_id] });
    assert.partialDeepStrictEqual(resumo, { id: `s-${trabalho_id}`, demanda_id: "I-1", ticket_id: 1 });
    assert.equal(resumo?.execucoes.find((e) => e.id === trabalho_id)?.fim, fim);
  };
  escopo(null);
  banco.prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = ?").run("2026-01-02T00:00:00.000Z", trabalho_id);
  escopo("2026-01-02T00:00:00.000Z");
  assert.deepEqual(resumosDasSessoesEmLote(banco, { execucoes: ["inexistente"] }), []);
  fechar();
});

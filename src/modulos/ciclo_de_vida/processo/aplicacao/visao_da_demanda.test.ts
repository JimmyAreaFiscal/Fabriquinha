import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  cadastrarProjetoLoja,
  comEvidencia,
  gravarAgregadoPronto,
  montarAgregadoDemanda,
  montarTicket,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import { gravarAnexos } from "../../evidencias/publico.ts";
import { visaoDaDemanda } from "./visao_da_demanda.ts";

function cenario() {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-1", "concluida"));
  const demanda = montarAgregadoDemanda("I-2", "em_execucao", { tickets: [montarTicket("I-2", 2, "implementar")] });
  gravarAgregadoPronto(
    banco,
    comEvidencia(comEvidencia(demanda, { tipo: "comportamento", dados: {} }), {
      tipo: "comportamento",
      dados: {},
      ticket_id: 2,
    }),
  );
  gravarAnexos(banco, { demanda_id: "I-2", tipo: "comportamento", ticket_id: 2 }, [
    { caminho: "a.png", sha256: "a".repeat(64), mime: "image/png", bytes: 3 },
  ]);
  return banco;
}

test("a visão traz o agregado e os anexos de cada evidência pelo dono dela", () => {
  const banco = cenario();
  const visao = visaoDaDemanda(banco, "I-2");
  assert.equal(visao.agregado.demanda.id, "I-2");
  assert.deepEqual(
    visao.evidencias.map(({ evidencia, anexos }) => [evidencia.ticket_id, anexos.map((a) => a.nome)]),
    [
      [undefined, []],
      [2, ["a.png"]],
    ],
  );
  assert.equal(banco.isTransaction, false);
});

test("a demanda que não existe é ErroDeInexistente e não deixa transação aberta", () => {
  const banco = cenario();
  assert.throws(() => visaoDaDemanda(banco, "I-9"), ErroDeInexistente);
  assert.equal(banco.isTransaction, false);
});

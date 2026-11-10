import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../apoio-testes/banco_temporario.ts";
import {
  cadastrarProjetoLoja,
  comEvidencia,
  gravarAgregadoPronto,
  montarAgregadoDemanda,
  montarTicket,
} from "../../../apoio-testes/cenarios_de_demanda.ts";
import { ErroDeInexistente } from "../../nucleo/erros.ts";
import { gravarAnexos } from "../../armazenamento/evidencia_demanda.ts";
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
  banco.prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-2', 'I-1')").run();
  gravarAnexos(banco, { demanda_id: "I-2", tipo: "comportamento", ticket_id: 2 }, [
    { caminho: "a.png", sha256: "a".repeat(64), mime: "image/png", bytes: 3 },
  ]);
  return banco;
}

test("a visão traz o agregado, as predecessoras e os anexos de cada evidência pelo dono dela", () => {
  const banco = cenario();
  const visao = visaoDaDemanda(banco, "I-2");
  assert.equal(visao.agregado.demanda.id, "I-2");
  assert.deepEqual(visao.predecessoras, [{ demanda_id: "I-1", estado: "concluida" }]);
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeRegra } from "../erros.ts";
import { Endereco } from "./endereco.ts";

test("Endereco: forma e lê de volta cada endereço", () => {
  assert.equal(Endereco.daDemanda("I-206").toString(), "I-206");
  assert.equal(Endereco.daRodada("I-206", 2).toString(), "I-206.R2");
  assert.equal(Endereco.doTicket("I-206", 3).toString(), "I-206.T3");
  for (const texto of ["I-206", "I-206.R2", "I-206.T3", "I-1.T10"]) assert.equal(Endereco.ler(texto).toString(), texto);
});

const campos = ({ demanda_id, rodada_id, ticket_id }: Endereco) => ({ demanda_id, rodada_id, ticket_id });

test("Endereco.ler: separa demanda, rodada e ticket", () => {
  assert.deepEqual(campos(Endereco.ler("I-206.T3")), { demanda_id: "I-206", rodada_id: undefined, ticket_id: 3 });
  assert.deepEqual(campos(Endereco.ler("I-206.R2")), { demanda_id: "I-206", rodada_id: 2, ticket_id: undefined });
  assert.deepEqual(campos(Endereco.ler("I-206")), { demanda_id: "I-206", rodada_id: undefined, ticket_id: undefined });
});

test("Endereco.ler: o número sozinho é a demanda", () => {
  assert.equal(Endereco.ler("12").toString(), "I-12");
  assert.equal(Endereco.ler("I-12").toString(), "I-12");
});

test("Endereco.ler: a demanda aceita o prefixo i ou I com hífen opcional, sem relaxar rodada e ticket", () => {
  for (const texto of ["i-29", "i29", "I29"]) assert.equal(Endereco.ler(texto).toString(), "I-29", texto);
  for (const ruim of ["i-29.R1", "i29.T1", "I29.R1"]) assert.throws(() => Endereco.ler(ruim), ErroDeRegra, ruim);
});

test("Endereco.ler: recusa o que não é endereço dizendo o formato", () => {
  for (const ruim of [
    "I-x",
    "I-0",
    "I-012",
    "012",
    "0",
    "T3",
    "R2",
    "T-3",
    "I-206.T0",
    "I-206.T03",
    "I-206.R02",
    "I-206.X3",
    "I-206.t3",
    "I-206. T3",
    "I-206.T 3",
    " I-206.T3",
    "I-206.T3\n",
    "I-206.T99999999999999999999",
    "206.T3",
    "I-206.T",
    "I-206.T3.R2",
    "",
  ])
    assert.throws(
      () => Endereco.ler(ruim),
      (e) => e instanceof ErroDeRegra && e.message.includes("I-206.T3") && e.message.includes(JSON.stringify(ruim)),
      ruim,
    );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ErroDaApiDoAgente,
  PedidoEvidenciaAdd,
  PedidoRevisaoDecidir,
  PedidoTicketCriar,
  RespostaDemandaVer,
  RespostaEvidenciaAdd,
  RespostaEvidenciaSchema,
  RespostaProjetoVer,
  RespostaRevisaoDecidir,
  RespostaTicketCriar,
  RespostaTicketVer,
} from "./agente.ts";

test("as respostas dos sete comandos do agente aceitam o que os casos de uso devolvem", () => {
  assert.ok(RespostaDemandaVer.parse({ demanda: { id: "I-1" }, rodadas: [], decisoes: [], tickets: [] }));
  assert.equal(RespostaTicketVer.parse({ ticket: "I-1.T2", estado: "aberto", motivo: "falhou" }).motivo, "falhou");
  assert.deepEqual(RespostaTicketCriar.parse({ rodada: "I-1.R1", tickets: ["I-1.T3"] }).tickets, ["I-1.T3"]);
  assert.equal(RespostaRevisaoDecidir.parse({ ticket: "I-1.T2", resultado: "aprovado" }).resultado, "aprovado");
  assert.ok(RespostaEvidenciaSchema.parse({ dados: { type: "object" }, arquivos: { aceita: false } }));
  assert.equal(
    RespostaEvidenciaAdd.parse({ ticket: "I-1.T2", tipo: "comportamento", veredito: "atende" }).veredito,
    "atende",
  );
  assert.throws(() => RespostaEvidenciaAdd.parse({ ticket: "I-1.T2", tipo: "inexistente" }));
  assert.throws(() => RespostaProjetoVer.parse({}));
});

test("os pedidos exigem o endereço e trazem os anexos com o caminho e o SHA-256", () => {
  assert.deepEqual(PedidoTicketCriar.parse({ rodada: "I-1.R1" }), { rodada: "I-1.R1" });
  assert.equal(
    PedidoRevisaoDecidir.parse({ ticket: "I-1.T2", veredito: "reprovar", plano: [] }).plano?.constructor,
    Array,
  );
  assert.deepEqual(PedidoEvidenciaAdd.parse({ ticket: "I-1.T2", tipo: "comportamento" }).anexos, []);
  const anexo = { caminho: "/w/a.txt", sha256: "a".repeat(64) };
  assert.deepEqual(PedidoEvidenciaAdd.parse({ ticket: "I-1.T2", tipo: "comportamento", anexos: [anexo] }).anexos, [
    anexo,
  ]);
  assert.throws(() => PedidoEvidenciaAdd.parse({ ticket: "I-1.T2", tipo: "x", anexos: [{ ...anexo, sha256: "zz" }] }));
  assert.throws(() => PedidoTicketCriar.parse({ rodada: "" }));
});

test("o erro leva a mensagem, a orientação opcional e o código de saída do CLI", () => {
  assert.deepEqual(ErroDaApiDoAgente.parse({ mensagem: "falhou (tente)", orientacao: "tente", codigo_de_saida: 1 }), {
    mensagem: "falhou (tente)",
    orientacao: "tente",
    codigo_de_saida: 1,
  });
  assert.throws(() => ErroDaApiDoAgente.parse({ mensagem: "x", codigo_de_saida: 3 }));
});

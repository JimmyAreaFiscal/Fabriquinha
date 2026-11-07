import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, Ator, AtorExterno, exigirAtor, FABRIQUINHA } from "./ator.ts";
import { ErroDeEscopo } from "./erros.ts";

test("Ator aceita os quatro tipos, cada um só com os seus dados", () => {
  assert.deepEqual(Ator.parse({ tipo: "auditor" }), AUDITOR);
  assert.deepEqual(Ator.parse({ tipo: "fabriquinha" }), FABRIQUINHA);
  assert.deepEqual(Ator.parse({ tipo: "agente", trabalho_id: "e-1" }), { tipo: "agente", trabalho_id: "e-1" });
  const externo = { tipo: "externo", ferramenta: "claude", sessao: "S1" };
  assert.deepEqual(Ator.parse(externo), externo);
  assert.deepEqual(AtorExterno.parse(externo), externo);
});

test("Ator recusa o que falta ou sobra do tipo", () => {
  for (const invalido of [
    { tipo: "agente" },
    { tipo: "agente", trabalho_id: "" },
    { tipo: "externo" },
    { tipo: "externo", ferramenta: "Claude Code", sessao: "S1" },
    { tipo: "externo", ferramenta: "claude", sessao: "" },
    { tipo: "desconhecido" },
  ]) {
    assert.equal(Ator.safeParse(invalido).success, false, JSON.stringify(invalido));
  }
  assert.equal(AtorExterno.safeParse(AUDITOR).success, false);
});

test("exigirAtor deixa passar o tipo permitido", () => {
  exigirAtor(AUDITOR, "decidir", "auditor");
  exigirAtor(FABRIQUINHA, "decidir", "auditor", "fabriquinha");
});

test("exigirAtor recusa os outros tipos com a mensagem e a orientação de quem pode", () => {
  const recusa =
    (ator: Ator, acao: string, ...permitidos: Ator["tipo"][]) =>
    () => {
      exigirAtor(ator, acao, ...permitidos);
    };
  assert.throws(recusa(FABRIQUINHA, "aprovar", "auditor"), {
    name: "ErroDeEscopo",
    message: "só o Auditor pode aprovar (peça ao Auditor pelo web)",
  });
  assert.throws(recusa(AUDITOR, "reservar", "fabriquinha"), {
    message: "só a Fabriquinha pode reservar (ela faz isso sozinha ao executar o ticket)",
  });
  assert.throws(
    recusa(AUDITOR, "decidir", "agente", "externo"),
    new ErroDeEscopo(
      "só o Agente ou a IA externa pode decidir",
      "peça à sessão do agente; peça à ferramenta que registrou a demanda",
    ),
  );
});

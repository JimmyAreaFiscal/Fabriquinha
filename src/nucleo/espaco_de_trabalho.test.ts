import assert from "node:assert/strict";
import { test } from "node:test";
import { espacoDaDemanda, espacoDaRodada, espacoDoTicket, EspacoDeTrabalho } from "./espaco_de_trabalho.ts";
import { Endereco } from "./item_de_trabalho.ts";
import { EtapaTicket } from "./primitivos.ts";

const projeto = { nome: "proj", branch_base: "main" };
const ag = { demanda: { id: "I-7" } } as Parameters<typeof espacoDoTicket>[0];
const ETAPAS_COM_ESPACO = EtapaTicket.options.filter((e) => e !== "entender_e_desenhar");

for (const etapa of ETAPAS_COM_ESPACO) {
  test(`${etapa}: sem rodada_id usa o Espaço da demanda, com rodada_id o da rodada`, () => {
    const semRodada = espacoDoTicket(ag, { rodada_id: undefined }, projeto, "/r");
    assert.deepEqual(semRodada, {
      dono: Endereco.daDemanda("I-7"),
      branch: "fabriquinha/I-7",
      base: "main",
      pasta: "/r/worktrees/proj/I-7/demanda",
    });
    const comRodada = espacoDoTicket(ag, { rodada_id: 3 }, projeto, "/r");
    assert.deepEqual(comRodada, {
      dono: Endereco.daRodada("I-7", 3),
      branch: "fabriquinha/I-7-3",
      base: "fabriquinha/I-7",
      pasta: "/r/worktrees/proj/I-7/rodadas/3",
    });
    EspacoDeTrabalho.parse(semRodada);
    EspacoDeTrabalho.parse(comRodada);
  });
}

test("os Espaços recusam projeto ou demanda inválidos", () => {
  assert.throws(() => espacoDaDemanda({ nome: "../x", branch_base: "main" }, "I-7", "/r"));
  assert.throws(() => espacoDaRodada(projeto, "I/7", 1, "/r"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { espacoDaDemanda, espacoDaRodada, espacoDoTicket, EspacoDeTrabalho } from "./espaco_de_trabalho.ts";
import { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { EtapaTicket } from "../../etapas/catalogo.ts";

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

test("espaco.pr é o PR da rodada, ou o final da demanda sem rodada; sem linha, não há pr", () => {
  const pr = (rodada_id?: number) => ({
    rodada_id,
    numero: rodada_id ?? 9,
    url: "https://pr/1",
    head: "abc",
    estado: "aberto" as const,
    atualizado_em: "2026-01-01T00:00:00.000Z",
  });
  const comPrs = { ...ag, pull_requests: [pr(3), pr()] };
  assert.deepEqual(espacoDoTicket(comPrs, { rodada_id: 3 }, projeto, "/r").pr, {
    numero: 3,
    url: "https://pr/1",
    head: "abc",
    estado: "aberto",
  });
  assert.equal(espacoDoTicket(comPrs, {}, projeto, "/r").pr?.numero, 9);
  assert.equal(espacoDoTicket(comPrs, { rodada_id: 4 }, projeto, "/r").pr, undefined);
});

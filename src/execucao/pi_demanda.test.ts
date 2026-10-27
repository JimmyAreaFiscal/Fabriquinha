import assert from "node:assert/strict";
import { test } from "node:test";
import type { TicketDemanda } from "../dominio/agregado_demanda.ts";
import { EtapaTicket } from "../dominio/primitivos.ts";
import { argumentosPi, PACOTE, skillsDaEtapa } from "./pi.ts";
import { argumentosPiDemanda, skillsDaEtapaDemanda, skillsPendentes } from "./pi_demanda.ts";

const base = { raiz: "/r", sessaoPi: "s", confianca: undefined, modo: "autonomo" as const };
const ticket = (campos: Partial<TicketDemanda> = {}) =>
  ({ etapa: "implementar", ...campos }) as unknown as TicketDemanda;
const daEtapa = { etapa: "implementar" as const, modelo_provedor: "p2", modelo_nome: "m2", effort: "low" as const };
const flags = (args: string[], flag: string) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));

test("revisar_rodada traz só as duas skills do catálogo (CA-3)", () => {
  const args = argumentosPiDemanda({ ...base, ticket: ticket({ etapa: "revisar_rodada" }), etapasDoProjeto: [] });
  assert.deepEqual(
    flags(args, "--skill"),
    ["artefato-explicacao-fitness", "artefato-comprovacao-criterios"].map((s) => `${PACOTE}/skills/${s}`),
  );
});

test("modelo e effort: ticket, senão etapa do projeto, senão nenhum flag (CA-4 a CA-6)", () => {
  const doTicket = ticket({ modelo_provedor: "p1", modelo_nome: "m1", effort: "high" });
  const a = argumentosPiDemanda({ ...base, ticket: doTicket, etapasDoProjeto: [daEtapa] });
  assert.deepEqual([flags(a, "--provider"), flags(a, "--model"), flags(a, "--thinking")], [["p1"], ["m1"], ["high"]]);
  const b = argumentosPiDemanda({ ...base, ticket: ticket(), etapasDoProjeto: [daEtapa] });
  assert.deepEqual([flags(b, "--provider"), flags(b, "--model"), flags(b, "--thinking")], [["p2"], ["m2"], ["low"]]);
  const c = argumentosPiDemanda({ ...base, ticket: ticket(), etapasDoProjeto: [{ etapa: "planejar" }] });
  for (const f of ["--provider", "--model", "--thinking"]) assert.deepEqual(flags(c, f), []);
});

test("com as skills no pacote, nada fica pendente (CA-12)", () => {
  assert.deepEqual(skillsPendentes(), []);
  assert.deepEqual(skillsDaEtapaDemanda("planejar"), ["artefato-plano"]);
  assert.deepEqual(skillsDaEtapaDemanda("revisar_demanda"), [
    "artefato-comprovacao-criterios",
    "artefato-testes-estresse",
    "artefato-analise-seguranca",
  ]);
  for (const etapa of EtapaTicket.options)
    for (const s of skillsDaEtapaDemanda(etapa)) assert.ok(!skillsPendentes().includes(s));
});

test("etapas legadas: sem skills, os argumentos são os de sempre (CA-8)", () => {
  for (const etapa of ["registro", "desenho", "desenvolvimento", "revisao", "encerramento", "sessao"] as const) {
    const args = argumentosPi({ ...base, etapa, modelo: undefined });
    assert.deepEqual(
      flags(args, "--skill"),
      skillsDaEtapa(etapa).map((s) => `${PACOTE}/skills/${s}`),
    );
  }
});

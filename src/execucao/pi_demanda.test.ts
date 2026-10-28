import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TicketDemanda } from "../dominio/agregado_demanda.ts";
import { EtapaTicket } from "../dominio/primitivos.ts";
import { PACOTE } from "./pi.ts";
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

test("pacote real: nada pendente e skills na ordem do catálogo (CA-12)", () => {
  assert.deepEqual(skillsPendentes(), []);
  assert.deepEqual(skillsDaEtapaDemanda("planejar"), ["artefato-plano"]);
  assert.deepEqual(skillsDaEtapaDemanda("revisar_demanda"), [
    "artefato-comprovacao-criterios",
    "artefato-testes-estresse",
    "artefato-analise-seguranca",
  ]);
  for (const etapa of ["planejar", "revisar_demanda"] as const) {
    const args = argumentosPiDemanda({ ...base, ticket: ticket({ etapa }), etapasDoProjeto: [] });
    assert.deepEqual(
      flags(args, "--skill"),
      skillsDaEtapaDemanda(etapa).map((s) => `${PACOTE}/skills/${s}`),
    );
  }
});

test("pacote com skills faltando: as ausentes ficam pendentes, sem repetição (CA-12)", () => {
  const pacote = mkdtempSync(join(tmpdir(), "pacote-"));
  try {
    mkdirSync(join(pacote, "skills", "artefato-comprovacao-criterios"), { recursive: true });
    const pendentes = skillsPendentes(pacote);
    assert.ok(pendentes.includes("artefato-plano"));
    assert.ok(!pendentes.includes("artefato-comprovacao-criterios"));
    assert.equal(new Set(pendentes).size, pendentes.length);
    assert.deepEqual(skillsDaEtapaDemanda("revisar_demanda", pacote), ["artefato-comprovacao-criterios"]);
    for (const etapa of EtapaTicket.options)
      for (const s of skillsDaEtapaDemanda(etapa, pacote)) assert.ok(!pendentes.includes(s));
  } finally {
    rmSync(pacote, { recursive: true, force: true });
  }
});

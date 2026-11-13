import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TicketDemanda } from "../../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { catalogoDaEtapa, EtapaTicket } from "../../../etapas/publico.ts";
import { HarnessPi, PACOTE, skillDoTipo } from "../../../../sessoes/publico.ts";
import { lancamentoDoTicket, skillsDaEtapaDemanda } from "./lancamento_do_ticket.ts";

// O pi do Auditor do teste não tem trust.json: a confiança fica no padrão, sem ler a da máquina.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "fabriquinha-pi-do-auditor-"));
const base = { raiz: "/r", sessao: "s", dir: "/r/execucoes/E-1", repositorio: tmpdir(), modo: "autonomo" as const };
/** A linha de comando que o adapter pi monta do lançamento do ticket. */
const argumentosDoAgenteDoTicket = (entrada: Parameters<typeof lancamentoDoTicket>[0]): string[] =>
  new HarnessPi().argumentosDoLancamento(lancamentoDoTicket(entrada));
const ticket = (campos: Partial<TicketDemanda> = {}) =>
  ({ etapa: "implementar", ...campos }) as unknown as TicketDemanda;
const daEtapa = {
  etapa: "implementar" as const,
  configuracao_agente: { modelo: { provedor: "p2", nome: "m2" }, effort: "low" as const },
};
const flags = (args: string[], flag: string) => args.flatMap((a, i) => (args[i - 1] === flag ? [a] : []));

test("o lançamento é do ticket, com a sessão, a pasta e o repositório de onde vem a confiança", () => {
  assert.partialDeepStrictEqual(lancamentoDoTicket({ ...base, ticket: ticket(), etapasDoProjeto: [] }), {
    tipo: "ticket",
    sessao: "s",
    dir: "/r/execucoes/E-1",
    repositorio: tmpdir(),
  });
});

test("revisar_rodada traz só as duas skills do catálogo (CA-3)", () => {
  const args = argumentosDoAgenteDoTicket({
    ...base,
    ticket: ticket({ etapa: "revisar_rodada" }),
    etapasDoProjeto: [],
  });
  assert.deepEqual(
    flags(args, "--skill"),
    ["artefato-explicacao-fitness", "artefato-comprovacao-criterios"].map((s) => `${PACOTE}/skills/${s}`),
  );
});

test("modelo e effort: ticket, senão etapa do projeto, senão nenhum flag (CA-4 a CA-6)", () => {
  const doTicket = ticket({ configuracao_agente: { modelo: { provedor: "p1", nome: "m1" }, effort: "high" } });
  const a = argumentosDoAgenteDoTicket({ ...base, ticket: doTicket, etapasDoProjeto: [daEtapa] });
  assert.deepEqual([flags(a, "--provider"), flags(a, "--model"), flags(a, "--thinking")], [["p1"], ["m1"], ["high"]]);
  const b = argumentosDoAgenteDoTicket({ ...base, ticket: ticket(), etapasDoProjeto: [daEtapa] });
  assert.deepEqual([flags(b, "--provider"), flags(b, "--model"), flags(b, "--thinking")], [["p2"], ["m2"], ["low"]]);
  const c = argumentosDoAgenteDoTicket({ ...base, ticket: ticket(), etapasDoProjeto: [{ etapa: "planejar" }] });
  for (const f of ["--provider", "--model", "--thinking"]) assert.deepEqual(flags(c, f), []);
});

test("pacote real: skills na ordem do catálogo (CA-12)", () => {
  assert.deepEqual(skillsDaEtapaDemanda("planejar"), ["artefato-plano"]);
  assert.deepEqual(skillsDaEtapaDemanda("revisar_demanda"), [
    "artefato-comprovacao-criterios",
    "artefato-testes-estresse",
    "artefato-analise-seguranca",
  ]);
  for (const etapa of ["planejar", "revisar_demanda"] as const) {
    const args = argumentosDoAgenteDoTicket({ ...base, ticket: ticket({ etapa }), etapasDoProjeto: [] });
    assert.deepEqual(
      flags(args, "--skill"),
      skillsDaEtapaDemanda(etapa).map((s) => `${PACOTE}/skills/${s}`),
    );
  }
});

test("pacote real: toda skill de agente do catálogo existe, em todas as etapas (CA-12)", () => {
  for (const etapa of EtapaTicket.options) {
    const doCatalogo = catalogoDaEtapa(etapa)
      .filter((item) => item.produtor === "agente")
      .map((item) => skillDoTipo(item.tipo));
    assert.deepEqual(skillsDaEtapaDemanda(etapa), doCatalogo, `skills do catálogo para ${etapa}`);
    for (const skill of doCatalogo) assert.ok(existsSync(join(PACOTE, "skills", skill)), `${skill} falta no pacote`);
  }
  assert.ok(EtapaTicket.options.includes("encerrar_rodada"));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { EtapaTicket } from "../dominio/primitivos.ts";
import { montarPrompt } from "./prompt.ts";
import { montarPromptDemanda } from "./prompt_demanda.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const NOVAS = EtapaTicket.options.filter((e) => e !== "demanda");

const ag = {
  demanda: { id: "I-206", titulo: "Busca", tipo: "problema", descricao: "A busca demora.", fase: "execucao" },
  tickets: [],
  decisoes: [],
  evidencias: [
    {
      demanda_id: "I-206",
      tipo: "criterios_aceite",
      em: AGORA,
      dados: {
        criterios: [
          { id: "CA-1", dado: "a", quando: "b", entao: "c" },
          { id: "CA-2", dado: "d", quando: "e", entao: "f" },
        ],
      },
    },
  ],
  rodadas: [{ demanda_id: "I-206", rodada_id: 2, titulo: "Índice", fase: "desenvolvimento", e2e: false, branch: "x" }],
  dependencias_rodada: [],
  criterios_citados: [{ demanda_id: "I-206", rodada_id: 2, criterio_id: "CA-2" }],
  dependencias_ticket: [{ demanda_id: "I-206", ticket_id: 3, depende_ticket_id: 1 }],
  caminhos_ticket: [{ demanda_id: "I-206", ticket_id: 3, caminho: "src/a.ts" }],
} as unknown as AgregadoDemanda;

const ticket = (etapa: string, campos: Partial<TicketDemanda> = {}) =>
  ({
    demanda_id: "I-206",
    ticket_id: 3,
    rodada_id: 2,
    titulo: "Fazer",
    descricao: "Detalhe.",
    etapa,
    ...campos,
  }) as TicketDemanda;
const base = { ag, projeto: { nome: "loja", branch_base: "main" }, worktree: "/w", saida: "/s" };
const montar = (
  etapa: string,
  campos: Partial<TicketDemanda> = {},
  retomada?: Parameters<typeof montarPromptDemanda>[0]["retomada"],
) => montarPromptDemanda({ ...base, ticket: ticket(etapa, campos), retomada });

test("as oito etapas montam com contexto da demanda, da rodada, do ticket e o modo próprio (CA-1)", () => {
  for (const etapa of NOVAS) {
    const p = montar(etapa);
    for (const trecho of [
      "I-206, Busca",
      "I-206.R2, Índice",
      "I-206.T3, Fazer",
      readFileSync(new URL(`etapas/${etapa}.md`, import.meta.url), "utf8").split("\n", 1)[0] ?? "",
    ])
      assert.ok(p.includes(trecho), `${etapa}: ${trecho}`);
  }
  const p = montar("implementar");
  assert.ok(p.includes("**CA-2**") && p.includes("I-206.T1") && p.includes("`src/a.ts`"));
  assert.match(montar("planejar", { rodada_id: undefined }), /não tem rodada/);
});

test("implementar e resolver_conflito não fazem commit nem PR (CA-2)", () => {
  for (const etapa of ["implementar", "resolver_conflito"])
    assert.match(montar(etapa), /não faz commit nem PR por conta própria/);
});

test("planejar é interativa e permite perguntar ao Auditor (CA-11)", () => {
  assert.match(montar("planejar"), /interativa.*perguntar a ele antes de submeter o plano/s);
});

test("devolução e reabertura trazem o motivo (CA-7)", () => {
  assert.match(
    montar("implementar", {}, { tipo: "devolucao", motivo: "testes falharam" }),
    /## Devolução[\s\S]*Motivo: testes falharam/,
  );
  assert.match(
    montar("implementar", {}, { tipo: "reabertura", motivo: "faltou X" }),
    /## Reabertura[\s\S]*Motivo: faltou X/,
  );
  assert.ok(!montar("implementar").includes("Motivo:"));
});

test("seção de evidências e skills vêm do catálogo", () => {
  const p = montar("revisar_rodada");
  assert.ok(
    p.includes("`explicacao_fitness`") &&
      p.includes("A Fabriquinha produz") &&
      p.includes("artefato-comprovacao-criterios"),
  );
  assert.ok(montar("encerrar_rodada").includes("`video_demonstracao` (opcional)"));
  const vazia = montar("sessao_em_aberto");
  assert.ok(vazia.includes("não tem evidência do agente") && vazia.includes("não produz evidência"));
  assert.match(vazia, /ticket corretivo da rodada I-206\.R2[^]*antes de concluir/);
  assert.ok(!vazia.includes("descartadas"));
});

test("ticket 3 da I-206 na rodada 2 só usa os endereços públicos (CA-10)", () => {
  for (const etapa of NOVAS) {
    const md = readFileSync(new URL(`etapas/${etapa}.md`, import.meta.url), "utf8");
    for (const texto of [montar(etapa), md]) {
      assert.doesNotMatch(texto, /\bT-\d|(?<![.\w])R\d/);
      assert.doesNotMatch(texto, /fabriquinha (ticket|issue|rodada)/);
    }
    assert.ok(montar(etapa).includes("I-206.T3"));
  }
});

test("etapa sem modo de trabalhar recusa nomeando a etapa (CA-9)", () => {
  assert.throws(
    () => montar("demanda"),
    (e: Error) => e.constructor === Error && e.message.includes("demanda"),
  );
});

test("o prompt legado das seis etapas segue montando (CA-8)", () => {
  for (const etapa of ["registro", "desenho", "desenvolvimento", "revisao", "encerramento", "sessao"] as const) {
    const t = {
      id: 2,
      issue: 1,
      etapa,
      titulo: "T",
      descricao: "d",
      status: "aberto",
      origem: "fabriquinha",
      criadoEm: AGORA,
    };
    const legado = {
      issue: {
        id: 1,
        projeto: "loja",
        titulo: "I",
        tipo: "problema",
        descricao: "d",
        fase: etapa,
        deps: [],
        criadaEm: AGORA,
      },
      tickets: [t],
      execucoes: [],
      decisoes: [],
      evidencias: [],
    };
    const p = montarPrompt({
      ag: legado,
      ticket: t,
      instrucao: undefined,
      projeto: { nome: "loja", branchBase: "main" },
      worktree: "/w",
      saida: "/s",
      modo: "autonomo",
    } as unknown as Parameters<typeof montarPrompt>[0]);
    assert.ok(p.includes(readFileSync(new URL(`etapas/${etapa}.md`, import.meta.url), "utf8").trim()));
    assert.ok(p.includes("- Seu ticket: T-2"));
  }
});

test("sem critérios, citações, título, descrição, dependências nem caminhos, cada seção diz que está vazia", () => {
  const vazio = {
    ...ag,
    demanda: { ...ag.demanda, descricao: "" },
    evidencias: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
  };
  const p = montarPromptDemanda({
    ...base,
    ag: vazio,
    ticket: ticket("implementar", { titulo: undefined, descricao: undefined }),
  });
  assert.ok(p.includes("sem título") && p.includes("(vazio)") && p.includes("(nenhum)") && p.includes("(nenhuma)"));
});

test("as revisões pedem revisao decidir do próprio ticket como último passo (CA-1)", () => {
  const rodada = montar("revisar_rodada");
  assert.match(rodada, /fabriquinha revisao decidir I-206\.T3 aprovar/);
  assert.match(rodada, /fabriquinha revisao decidir I-206\.T3 reprovar --motivo <texto> --correcoes/);
  const demanda = montar("revisar_demanda");
  assert.match(demanda, /fabriquinha revisao decidir I-206\.T3 aprovar/);
  assert.match(demanda, /fabriquinha revisao decidir I-206\.T3 reprovar --motivo <texto> --plano/);
  assert.ok(!demanda.includes("--correcoes") && !rodada.includes("--plano"));
});

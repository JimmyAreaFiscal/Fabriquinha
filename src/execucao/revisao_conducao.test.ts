// Condução da revisão com pi falso e git real temporário (CA-1, CA-2, CA-11, CA-12).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { AUDITOR } from "../dominio/agregado.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { reabrirTicket } from "../dominio/transicoes_demanda.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { conduzirRevisao } from "./revisao_conducao.ts";
import { cenarioRevisao, REF_GLOBAL, REF_RODADA } from "./revisao_cenario.test.ts";

const estado = (banco: Parameters<typeof carregarDemanda>[0], ticket_id: number) => {
  const ag = carregarDemanda(banco, "I-1");
  return {
    ticket: ag.tickets.find((t) => t.ticket_id === ticket_id),
    fase: ag.demanda.fase,
    rodada: ag.rodadas[0]?.fase,
    decisoes: ag.decisoes.length,
  };
};

test("CA-1: o ticket da rodada fica em_execucao e o pi roda na worktree da rodada", async () => {
  const { c, banco, pastas } = await cenarioRevisao();
  const quando: string[] = [];
  const r = await conduzirRevisao(banco, REF_RODADA, {
    limiteMin: 1,
    preparar: () => void quando.push(estado(banco, 2).ticket?.status ?? ""),
  });
  assert.equal(r, "aguardando_decisao");
  assert.deepEqual(quando, ["em_execucao"]);
  assert.equal(estado(banco, 2).ticket?.status, "em_execucao");
  assert.deepEqual(pastas(), [caminhoDaWorktreeRodada(c.raiz, "loja", { demanda_id: "I-1", rodada_id: 1 })]);
});

test("CA-11: o ticket global roda na worktree da demanda", async () => {
  const { c, banco, pastas } = await cenarioRevisao({ integral: true });
  assert.equal(await conduzirRevisao(banco, REF_GLOBAL, { limiteMin: 1 }), "aguardando_decisao");
  assert.deepEqual(pastas(), [caminhoDaWorktreeDemanda(c.raiz, "loja", "I-1")]);
});

test("CA-2: pi com falha deixa o ticket falhou, sem decisão e com a rodada em revisao", async () => {
  const { banco } = await cenarioRevisao({ falha: true });
  assert.equal(await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 }), "falhou");
  const e = estado(banco, 2);
  assert.deepEqual(
    [e.ticket?.status, e.ticket?.motivo_falha, e.rodada, e.fase, e.decisoes],
    ["falhou", "o agente parou com stopReason error: limite de uso", "revisao", "execucao", 0],
  );
});

test("CA-12: pi com falha na revisão integral deixa a demanda em revisao_demanda", async () => {
  const { banco } = await cenarioRevisao({ integral: true, falha: true });
  assert.equal(await conduzirRevisao(banco, REF_GLOBAL, { limiteMin: 1 }), "falhou");
  const e = estado(banco, 3);
  assert.deepEqual([e.ticket?.status, e.fase, e.decisoes], ["falhou", "revisao_demanda", 0]);
});

test("preparação que lança falha o ticket sem rodar o pi", async () => {
  const { banco, pastas } = await cenarioRevisao();
  const r = await conduzirRevisao(banco, REF_RODADA, {
    limiteMin: 1,
    preparar: () => Promise.reject(new Error("git quebrou")),
  });
  assert.equal(r, "falhou");
  assert.match(estado(banco, 2).ticket?.motivo_falha ?? "", /git quebrou/);
  assert.deepEqual(pastas(), []);
});

test("ticket reaberto leva a instrução ao prompt como reabertura", async () => {
  const { c, banco } = await cenarioRevisao({ falha: true });
  await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 });
  comDemanda(banco, "I-1", (ag) =>
    reabrirTicket(ag, { ticket_id: 2, instrucao: "refaça com atenção" }, AUDITOR, { agora: new Date().toISOString() }),
  );
  delete process.env.FALSO_PI;
  assert.equal(await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 }), "aguardando_decisao");
  const prompts = readdirSync(`${c.raiz}/execucoes`).map((d) =>
    readFileSync(`${c.raiz}/execucoes/${d}/prompt.md`, "utf8"),
  );
  assert.ok(prompts.some((p) => p.includes("refaça com atenção")));
});

test("ticket inexistente é recusado", async () => {
  const { banco } = await cenarioRevisao();
  await assert.rejects(
    conduzirRevisao(banco, { demanda_id: "I-1", ticket_id: 99 }, { limiteMin: 1 }),
    /I-1.T99 não existe/,
  );
});

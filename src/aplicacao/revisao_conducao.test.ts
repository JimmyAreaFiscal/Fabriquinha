// Condução da revisão com pi falso e git real temporário (CA-1, CA-2, CA-11, CA-12).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { motivoDaFalhaDoTicket } from "../nucleo/tentativa.ts";
import { AUDITOR } from "../nucleo/ator.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { reabrirTicket } from "../nucleo/transicoes_demanda.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../infra/repositorio/worktree-demanda.ts";
import { conferirPromptComFoto } from "./fotos_retorno/conferir_foto.ts";
import { conduzirRevisao } from "./revisao_conducao.ts";
import { cenarioRevisao, REF_GLOBAL, REF_RODADA } from "../../apoio-testes/cenarios_de_demanda.ts";

const estado = (banco: Parameters<typeof carregarDemanda>[0], ticket_id: number) => {
  const ag = carregarDemanda(banco, "I-1");
  const ticket = ag.tickets.find((t) => t.ticket_id === ticket_id);
  assert.ok(ticket);
  return {
    ticket,
    motivo: motivoDaFalhaDoTicket(ag.tentativas, ticket),
    estado: ag.demanda.estado,
    rodada: ag.rodadas[0]?.estado,
    decisoes: ag.decisoes.length,
  };
};

const SEM_DECISAO = "a revisão terminou sem registrar a decisão";

test("CA-1: o pi roda na worktree da rodada e, sem decisão, o ticket falha com o motivo", async () => {
  const { c, banco, pastas } = await cenarioRevisao();
  const quando: string[] = [];
  const r = await conduzirRevisao(banco, REF_RODADA, {
    limiteMin: 1,
    preparar: () => void quando.push(estado(banco, 2).ticket.estado),
  });
  assert.equal(r, "falhou");
  assert.deepEqual(quando, ["em_execucao"]);
  assert.deepEqual([estado(banco, 2).ticket.estado, estado(banco, 2).motivo], ["falhou", SEM_DECISAO]);
  assert.deepEqual(pastas(), [caminhoDaWorktreeRodada(c.raiz, "loja", { demanda_id: "I-1", rodada_id: 1 })]);
});

test("CA-3: o revisor que decide deixa o ticket concluído, sem falha", async () => {
  const { banco, piFalso } = await cenarioRevisao();
  piFalso.roteirizar([
    {
      cli: [
        [
          "revisao",
          "decidir",
          "I-1.T2",
          "reprovar",
          "--motivo",
          "falta teste",
          "--correcoes",
          JSON.stringify([{ ticket_id: 1, titulo: "corrige", descricao: "d", caminhos: [], depende: [] }]),
        ],
      ],
    },
  ]);
  assert.equal(await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 }), "decidida");
  const e = estado(banco, 2);
  assert.deepEqual([e.ticket.estado, e.decisoes], ["concluido", 1]);
});

test("CA-11: o ticket global roda na worktree da demanda e, sem decisão, falha", async () => {
  const { c, banco, pastas } = await cenarioRevisao({ integral: true });
  assert.equal(await conduzirRevisao(banco, REF_GLOBAL, { limiteMin: 1 }), "falhou");
  assert.equal(estado(banco, 3).motivo, SEM_DECISAO);
  assert.deepEqual(pastas(), [caminhoDaWorktreeDemanda(c.raiz, "loja", "I-1")]);
});

test("CA-2: pi com falha deixa o ticket falhou, sem decisão e com a rodada em revisao", async () => {
  const { banco, piFalso } = await cenarioRevisao();
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  assert.equal(await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 }), "falhou");
  const e = estado(banco, 2);
  assert.deepEqual(
    [e.ticket.estado, e.motivo, e.rodada, e.estado, e.decisoes],
    ["falhou", "o agente parou com stopReason error: limite de uso", "revisar_rodada", "em_execucao", 0],
  );
});

test("CA-12: pi com falha na revisão integral deixa a demanda em revisar_demanda", async () => {
  const { banco, piFalso } = await cenarioRevisao({ integral: true });
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  assert.equal(await conduzirRevisao(banco, REF_GLOBAL, { limiteMin: 1 }), "falhou");
  const e = estado(banco, 3);
  assert.deepEqual([e.ticket.estado, e.estado, e.decisoes], ["falhou", "revisar_demanda", 0]);
});

test("preparação que lança falha o ticket sem rodar o pi", async () => {
  const { banco, pastas } = await cenarioRevisao();
  const r = await conduzirRevisao(banco, REF_RODADA, {
    limiteMin: 1,
    preparar: () => Promise.reject(new Error("git quebrou")),
  });
  assert.equal(r, "falhou");
  assert.match(estado(banco, 2).motivo ?? "", /git quebrou/);
  assert.deepEqual(pastas(), []);
});

test("ticket reaberto leva a instrução ao prompt como reabertura", async () => {
  const { c, banco, piFalso } = await cenarioRevisao();
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 });
  comDemanda(banco, "I-1", (ag) =>
    reabrirTicket(ag, { ticket_id: 2, instrucao: "refaça com atenção" }, AUDITOR, { agora: new Date().toISOString() }),
  );
  piFalso.roteirizar([{}]);
  assert.equal(await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 }), "falhou");
  const prompts = readdirSync(`${c.raiz}/execucoes`).map((d) =>
    readFileSync(`${c.raiz}/execucoes/${d}/prompt.md`, "utf8"),
  );
  assert.ok(prompts.some((p) => p.includes("refaça com atenção")));
});

test("ticket inexistente é rejeitado", async () => {
  const { banco } = await cenarioRevisao();
  await assert.rejects(
    conduzirRevisao(banco, { demanda_id: "I-1", ticket_id: 99 }, { limiteMin: 1 }),
    /I-1.T99 não existe/,
  );
});

test("foto do retorno ao agente na revisão da conduzida: reabertura", async () => {
  const { c, banco, piFalso } = await cenarioRevisao();
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 });
  comDemanda(banco, "I-1", (ag) =>
    reabrirTicket(ag, { ticket_id: 2, instrucao: "refaça com atenção" }, AUDITOR, { agora: new Date().toISOString() }),
  );
  piFalso.roteirizar([{}]);
  await conduzirRevisao(banco, REF_RODADA, { limiteMin: 1 });
  conferirPromptComFoto(piFalso.prompts().at(-1)?.prompt ?? "", c.raiz, "revisao_reabertura");
});

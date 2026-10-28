// Revisão integral com git real temporário e pi falso (CA-9 a CA-17).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ator } from "../dominio/agregado.ts";
import { submeterEvidenciaDemanda } from "../dominio/evidencia_demanda.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { caminhoDaWorktreeDemanda } from "../repositorio/worktree-demanda.ts";
import { cenarioRevisao } from "./revisao_cenario.test.ts";
import { conduzirRevisaoIntegral, decidirRevisaoIntegral, iniciarRevisaoIntegral } from "./revisao_demanda.ts";

type Banco = Parameters<typeof carregarDemanda>[0];
const AGENTE: Ator = { tipo: "agente", execucao: 1, ticket: 3 };
const estado = (banco: Banco) => {
  const ag = carregarDemanda(banco, "I-1");
  return { fase: ag.demanda.fase, rodadas: ag.rodadas.map((r) => r.fase), tickets: ag.tickets };
};

const estresse = (resultado: string) => ({
  aplicavel: true,
  cenarios: [{ nome: "carga", objetivo: "o", comando: "c", resultado, observado: "o" }],
});
const seguranca = (severidade: string) => ({
  aplicavel: true,
  ameacas: [{ descricao: "d", mitigacao: "m" }],
  achados: [{ descricao: "injeção", severidade, recomendacao: "r" }],
});
const naoSeAplica = { aplicavel: false, cenarios: [], ameacas: [], achados: [] };

/** Submete as evidências do revisor integral. */
function evidenciar(banco: Banco, estres: object, seg: object, comprovacao = true) {
  const lista: [string, object][] = [
    ["comprovacao_criterios", { criterios: [{ id: "CA-1", atendido: comprovacao, arquivos: [] }] }],
    ["testes_estresse", estres],
    ["analise_seguranca", seg],
  ];
  comDemanda(banco, "I-1", (ag) =>
    lista.reduce(
      (a, [tipo, dados]) =>
        submeterEvidenciaDemanda(
          a,
          { tipo, dados, ticket_id: 3 } as never,
          { ferramenta: a.demanda.origem_ferramenta, sessao: a.demanda.origem_sessao },
          "2026-01-02T00:00:00.000Z",
        ),
      ag,
    ),
  );
}
const aprovar = (banco: Banco) =>
  decidirRevisaoIntegral(banco, { demanda_id: "I-1", ticket_id: 3, aprovado: true }, AGENTE);

test("CA-9: rodada pendente recusa citando-a e a demanda continua em execucao", async () => {
  const { banco } = await cenarioRevisao();
  assert.throws(() => iniciarRevisaoIntegral(banco, "I-1"), /rodada 1/);
  assert.equal(estado(banco).fase, "execucao");
});

test("CA-10: com todas as rodadas concluídas a demanda vai a revisao_demanda com revisar_demanda aberto", async () => {
  const { banco } = await cenarioRevisao();
  comDemanda(banco, "I-1", (ag) => ({
    ...ag,
    rodadas: ag.rodadas.map((r) => ({ ...r, fase: "concluida" as const })),
    tickets: ag.tickets
      .filter((t) => t.etapa !== "revisar_demanda")
      .map((t) => ({ ...t, status: "concluido" as const })),
  }));
  assert.equal(iniciarRevisaoIntegral(banco, "I-1").demanda.fase, "revisao_demanda");
  assert.equal(estado(banco).tickets.find((t) => t.etapa === "revisar_demanda")?.status, "aberto");
});

test("CA-11: o pi roda na worktree da demanda", async () => {
  const { c, banco, pastas } = await cenarioRevisao({ integral: true });
  assert.equal(await conduzirRevisaoIntegral(banco, "I-1", { limiteMin: 1 }), "falhou");
  assert.equal(estado(banco).tickets.find((t) => t.ticket_id === 3)?.status, "falhou");
  assert.deepEqual(pastas(), [caminhoDaWorktreeDemanda(c.raiz, "loja", "I-1")]);
});

test("CA-12: pi com falha deixa o ticket falhou e a demanda em revisao_demanda", async () => {
  const { banco } = await cenarioRevisao({ integral: true, falha: true });
  assert.equal(await conduzirRevisaoIntegral(banco, "I-1", { limiteMin: 1 }), "falhou");
  const e = estado(banco);
  assert.deepEqual([e.tickets.find((t) => t.ticket_id === 3)?.status, e.fase], ["falhou", "revisao_demanda"]);
  assert.equal(carregarDemanda(banco, "I-1").decisoes.length, 0);
});

test("conduzirRevisaoIntegral recusa demanda sem revisar_demanda", async () => {
  const { banco } = await cenarioRevisao();
  comDemanda(banco, "I-1", (ag) => ({ ...ag, tickets: ag.tickets.filter((t) => t.etapa !== "revisar_demanda") }));
  await assert.rejects(conduzirRevisaoIntegral(banco, "I-1", { limiteMin: 1 }), /não tem ticket revisar_demanda/);
});

test("CA-13: achado alto ou crítico recusa a aprovação", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  for (const sev of ["alta", "critica"]) {
    evidenciar(banco, estresse("passou"), seguranca(sev));
    assert.throws(() => aprovar(banco), /achado alto ou crítico: injeção/);
  }
  assert.equal(estado(banco).fase, "revisao_demanda");
});

test("CA-14: cenário que quebra recusa a aprovação", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, estresse("quebrou"), seguranca("baixa"));
  assert.throws(() => aprovar(banco), /cenário que quebrou: carga/);
  assert.equal(estado(banco).fase, "revisao_demanda");
});

test("CA-15: não se aplica sem justificativa recusa e pede a justificativa", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, estresse("passou"), seguranca("baixa"));
  banco.exec(`UPDATE evidencia_demanda SET dados = '${JSON.stringify(naoSeAplica)}' WHERE tipo = 'testes_estresse'`);
  assert.throws(() => aprovar(banco), /justificativa/);
  assert.equal(estado(banco).fase, "revisao_demanda");
});

test("CA-16: aprovada vai a encerramento com encerrar_demanda aberto; não se aplica justificado passa", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, { ...naoSeAplica, justificativa: "sem carga" }, seguranca("media"));
  aprovar(banco);
  const e = estado(banco);
  assert.equal(e.fase, "encerramento");
  assert.equal(e.tickets.find((t) => t.etapa === "encerrar_demanda")?.status, "aberto");
});

test("CA-17: reprovada volta a execucao com rodada corretiva nova e a concluída continua concluída", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  comDemanda(banco, "I-1", (ag) => ({
    ...ag,
    evidencias: [
      ...ag.evidencias,
      {
        demanda_id: "I-1",
        tipo: "criterios_aceite",
        dados: { criterios: [{ id: "CA-2" }] },
        em: "2026-01-01T00:00:00.000Z",
      },
    ] as never,
  }));
  decidirRevisaoIntegral(
    banco,
    {
      demanda_id: "I-1",
      ticket_id: 3,
      aprovado: false,
      exigencias: "falta tratar erro",
      plano: {
        demanda_id: "I-1",
        criterios: ["CA-2"],
        rodadas: [{ demanda_id: "I-1", rodada_id: 1, titulo: "corrige", e2e: false, criterios: ["CA-2"] }],
        tickets: [{ demanda_id: "I-1", ticket_id: 1, titulo: "c", descricao: "d", rodada_id: 1 }],
      },
    },
    AGENTE,
  );
  const e = estado(banco);
  assert.equal(e.fase, "execucao");
  assert.deepEqual(e.rodadas, ["concluida", "desenvolvimento"]);
});

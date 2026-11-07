// Revisão integral com git real temporário e pi falso (CA-9 a CA-17).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ator } from "../nucleo/ator.ts";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { submeterEvidenciaDemanda } from "../nucleo/evidencia_demanda.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { caminhoDaWorktreeDemanda } from "../infra/repositorio/worktree-demanda.ts";
import { abrirTrabalhoDoAgente, cenarioRevisao, REF_GLOBAL } from "../../apoio-testes/cenarios_de_demanda.ts";
import { conduzirRevisaoIntegral, decidirRevisaoIntegral, iniciarRevisaoIntegral } from "./revisao_demanda.ts";

type Banco = Parameters<typeof carregarDemanda>[0];
const revisorIntegral = (banco: Banco): Ator => abrirTrabalhoDoAgente(banco, REF_GLOBAL);
const estado = (banco: Banco) => {
  const ag = carregarDemanda(banco, "I-1");
  return { estado: ag.demanda.estado, rodadas: ag.rodadas.map((r) => r.estado), tickets: ag.tickets };
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
          a.demanda.criada_por,
          "2026-01-02T00:00:00.000Z",
        ),
      ag,
    ),
  );
}
const aprovar = (banco: Banco) =>
  decidirRevisaoIntegral(banco, { demanda_id: "I-1", ticket_id: 3, aprovado: true }, revisorIntegral(banco));

test("CA-9: rodada pendente recusa citando-a e a demanda continua em execucao", async () => {
  const { banco } = await cenarioRevisao();
  assert.throws(() => iniciarRevisaoIntegral(banco, "I-1"), /rodada 1/);
  assert.equal(estado(banco).estado, "em_execucao");
});

test("CA-10: com todas as rodadas concluídas a demanda vai a revisar_demanda com revisar_demanda aberto", async () => {
  const { banco } = await cenarioRevisao();
  comDemanda(banco, "I-1", (ag) => ({
    ...ag,
    rodadas: ag.rodadas.map((r) => ({ ...r, estado: "concluida" as const })),
    tickets: ag.tickets
      .filter((t) => t.etapa !== "revisar_demanda")
      .map((t) => ({ ...t, estado: "concluido" as const })),
  }));
  assert.equal(iniciarRevisaoIntegral(banco, "I-1").demanda.estado, "revisar_demanda");
  assert.equal(estado(banco).tickets.find((t) => t.etapa === "revisar_demanda")?.estado, "aberto");
});

test("CA-11: o pi roda na worktree da demanda", async () => {
  const { c, banco, pastas } = await cenarioRevisao({ integral: true });
  assert.equal(await conduzirRevisaoIntegral(banco, "I-1", { limiteMin: 1 }), "falhou");
  assert.equal(estado(banco).tickets.find((t) => t.ticket_id === 3)?.estado, "falhou");
  assert.deepEqual(pastas(), [caminhoDaWorktreeDemanda(c.raiz, "loja", "I-1")]);
});

test("CA-12: pi com falha deixa o ticket falhou e a demanda em revisar_demanda", async () => {
  const { banco, piFalso } = await cenarioRevisao({ integral: true });
  piFalso.roteirizar([{ parada: "error", erro: "limite de uso" }]);
  assert.equal(await conduzirRevisaoIntegral(banco, "I-1", { limiteMin: 1 }), "falhou");
  const e = estado(banco);
  assert.deepEqual([e.tickets.find((t) => t.ticket_id === 3)?.estado, e.estado], ["falhou", "revisar_demanda"]);
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
  assert.equal(estado(banco).estado, "revisar_demanda");
});

test("CA-14: cenário que quebra recusa a aprovação", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, estresse("quebrou"), seguranca("baixa"));
  assert.throws(() => aprovar(banco), /cenário que quebrou: carga/);
  assert.equal(estado(banco).estado, "revisar_demanda");
});

test("CA-15: não se aplica sem justificativa recusa e pede a justificativa", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, estresse("passou"), seguranca("baixa"));
  banco.exec(`UPDATE evidencia_demanda SET dados = '${JSON.stringify(naoSeAplica)}' WHERE tipo = 'testes_estresse'`);
  assert.throws(() => aprovar(banco), /justificativa/);
  assert.equal(estado(banco).estado, "revisar_demanda");
});

test("CA-16: aprovada vai a encerramento com encerrar_demanda aberto; não se aplica justificado passa", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, { ...naoSeAplica, justificativa: "sem carga" }, seguranca("media"));
  aprovar(banco);
  const e = estado(banco);
  assert.equal(e.estado, "encerrar_demanda");
  assert.equal(e.tickets.find((t) => t.etapa === "encerrar_demanda")?.estado, "aberto");
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
        autor: ag.demanda.criada_por,
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
    revisorIntegral(banco),
  );
  const e = estado(banco);
  assert.equal(e.estado, "em_execucao");
  assert.deepEqual(e.rodadas, ["concluida", "implementar"]);
});

test("I-266: a decisão do agente com o trabalho de outro ticket é recusada e nada é gravado", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const deOutroTicket = abrirTrabalhoDoAgente(banco, { demanda_id: "I-1", ticket_id: 2 });
  assert.throws(
    () => decidirRevisaoIntegral(banco, { demanda_id: "I-1", ticket_id: 3, aprovado: true }, deOutroTicket),
    ErroDeRegra,
  );
  assert.equal(carregarDemanda(banco, "I-1").decisoes.length, 0);
});

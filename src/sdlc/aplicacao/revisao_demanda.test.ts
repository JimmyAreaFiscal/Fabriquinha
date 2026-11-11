// Revisão integral com git real temporário e pi falso (CA-9 a CA-17).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ator } from "../nucleo/ator.ts";
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { Endereco } from "../nucleo/item_de_trabalho/item_de_trabalho.ts";
import { relogioFixo } from "../../compartilhado/nucleo/relogio.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import {
  abrirTrabalhoDoAgente,
  cenarioRevisao,
  REF_GLOBAL,
  comEvidencia,
} from "../../../apoio-testes/cenarios_de_demanda.ts";
import { decidirGate } from "./gates/decidir_gate.ts";
import { iniciarRevisaoIntegral } from "./revisao_demanda.ts";

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
        comEvidencia(a, { tipo, dados, ticket_id: 3 } as never, a.demanda.criada_por, "2026-01-02T00:00:00.000Z"),
      ag,
    ),
  );
}
const decidir = (banco: Banco, entrada: object, ator: Ator = revisorIntegral(banco)) =>
  decidirGate(banco, "gate_revisao_demanda", Endereco.daDemanda("I-1"), entrada, ator);
const aprovar = (banco: Banco) => decidir(banco, { resultado: "aprovado" });

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

test("CA-4: a revisão integral grava o instante do Relogio injetado", async () => {
  const { banco } = await cenarioRevisao();
  comDemanda(banco, "I-1", (ag) => ({
    ...ag,
    rodadas: ag.rodadas.map((r) => ({ ...r, estado: "concluida" as const })),
    tickets: ag.tickets
      .filter((t) => t.etapa !== "revisar_demanda")
      .map((t) => ({ ...t, estado: "concluido" as const })),
  }));
  const instante = "2030-03-04T05:06:07.000Z";
  const { demanda } = iniciarRevisaoIntegral(banco, "I-1", relogioFixo(instante));
  assert.equal(demanda.estado_alterado_em, instante);
});

test("CA-13: achado alto ou crítico recusa a aprovação", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  for (const sev of ["alta", "critica"]) {
    evidenciar(banco, estresse("passou"), seguranca(sev));
    await assert.rejects(aprovar(banco), /achado alto ou crítico: injeção/);
  }
  assert.equal(estado(banco).estado, "revisar_demanda");
});

test("CA-14: cenário que quebra recusa a aprovação", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, estresse("quebrou"), seguranca("baixa"));
  await assert.rejects(aprovar(banco), /cenário que quebrou: carga/);
  assert.equal(estado(banco).estado, "revisar_demanda");
});

test("CA-15: não se aplica sem justificativa recusa e pede a justificativa", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, estresse("passou"), seguranca("baixa"));
  banco.exec(`UPDATE evidencia_demanda SET dados = '${JSON.stringify(naoSeAplica)}' WHERE tipo = 'testes_estresse'`);
  await assert.rejects(aprovar(banco), /justificativa/);
  assert.equal(estado(banco).estado, "revisar_demanda");
});

test("CA-16: revisão aceita vai a encerramento com encerrar_demanda aberto; não se aplica justificado passa", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  evidenciar(banco, { ...naoSeAplica, justificativa: "sem carga" }, seguranca("media"));
  await aprovar(banco);
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
  await decidir(banco, {
    resultado: "reprovado",
    motivo: "falta tratar erro",
    correcoes: {
      demanda_id: "I-1",
      criterios: ["CA-2"],
      rodadas: [{ demanda_id: "I-1", rodada_id: 1, titulo: "corrige", e2e: false, criterios: ["CA-2"] }],
      tickets: [{ demanda_id: "I-1", ticket_id: 1, titulo: "c", descricao: "d", rodada_id: 1 }],
    },
  });
  const e = estado(banco);
  assert.equal(e.estado, "em_execucao");
  assert.deepEqual(e.rodadas, ["concluida", "implementar"]);
});

test("I-266: a decisão do agente com o trabalho de outro ticket é reprovada e nada é gravado", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const deOutroTicket = abrirTrabalhoDoAgente(banco, { demanda_id: "I-1", ticket_id: 2 });
  await assert.rejects(decidir(banco, { resultado: "aprovado" }, deOutroTicket), ErroDeRegra);
  assert.equal(carregarDemanda(banco, "I-1").decisoes.length, 0);
});

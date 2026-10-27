import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, EXTERNO, FABRIQUINHA } from "./agregado.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { arquivarDemanda, cancelarDemanda, satisfazDependencia } from "./cancelamento_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import type { FaseDemanda } from "./primitivos.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const c = { agora: t1 };
const D = "I-1";
const tk = (ticket_id: number, etapa: string, status: string) => ({
  demanda_id: D,
  ticket_id,
  etapa,
  status,
  status_alterado_em: t0,
});
const montar = (fase: string, m: Record<string, unknown> = {}) =>
  AgregadoDemanda.parse({
    demanda: {
      id: D,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: t0,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    tickets: [tk(1, "demanda", "concluido")],
    decisoes: [],
    evidencias: [],
    ...m,
  });
const pr = { numero: 7, url: "https://h/pr/7" };
const prog = (m: Record<string, unknown> = {}) => ({
  demanda_id: D,
  branch: "fabriquinha/I-1",
  base: "develop",
  pr,
  sha_verificado: "s1",
  limpeza_pendente: [],
  ...m,
});
const decisao = {
  demanda_id: D,
  ticket_id: 1,
  decisao_id: 1,
  resultado: "aprovado",
  por: "auditor",
  em: t0,
};
const FASES_ANDAMENTO = [
  "registro",
  "aprovacao_demanda",
  "planejamento",
  "aprovacao_planejamento",
  "execucao",
  "revisao_demanda",
  "encerramento",
];

test("CA-1: cancela em qualquer fase de andamento", () => {
  for (const fase of FASES_ANDAMENTO) {
    const r = cancelarDemanda(montar(fase), AUDITOR, c);
    assert.equal(r.demanda.fase, "cancelada");
    assert.equal(r.demanda.fase_alterada_em, t1);
  }
});

test("CA-2: tickets aberto/falhou fecham, em_execucao cancela e concluido fica", () => {
  const ag = montar("execucao", {
    tickets: [
      tk(1, "demanda", "concluido"),
      tk(2, "planejar", "aberto"),
      tk(3, "revisar_demanda", "falhou"),
      tk(4, "encerrar_demanda", "em_execucao"),
    ],
  });
  const r = cancelarDemanda(ag, AUDITOR, c);
  assert.deepEqual(
    r.tickets.map((t) => [t.status, t.status_alterado_em]),
    [
      ["concluido", t0],
      ["fechado", t1],
      ["fechado", t1],
      ["cancelado", t1],
    ],
  );
});

test("cancela com ticket falhou que tem motivo_falha: fecha e preserva o motivo", () => {
  const ag = montar("execucao", {
    tickets: [{ ...tk(3, "implementar", "falhou"), motivo_falha: "timeout do modelo" }],
  });
  const r = cancelarDemanda(ag, AUDITOR, c);
  assert.equal(r.demanda.fase, "cancelada");
  assert.deepEqual([r.tickets[0]?.status, r.tickets[0]?.motivo_falha], ["fechado", "timeout do modelo"]);
});

test("CA-3 e CA-7: histórico intacto, entrada não mutada e encerramento sem integração relido", () => {
  const ag = montar("encerramento", { decisoes: [decisao], encerramento: prog({ limpeza_pendente: [] }) });
  const antes = structuredClone(ag);
  const r = cancelarDemanda(ag, AUDITOR, c);
  assert.deepEqual(ag, antes);
  assert.deepEqual(r.decisoes, ag.decisoes);
  assert.deepEqual(r.evidencias, ag.evidencias);
  assert.deepEqual(r.encerramento, ag.encerramento);
  assert.equal(r.tickets.length, ag.tickets.length);
  assert.deepEqual(AgregadoDemanda.parse(r), r);
});

test("CA-4 e CA-10: só o Auditor cancela e arquiva", () => {
  for (const ator of [{ tipo: "agente" as const, ticket: 1, execucao: 1 }, FABRIQUINHA, EXTERNO]) {
    assert.throws(() => cancelarDemanda(montar("execucao"), ator, c), ErroDeEscopo);
    assert.throws(() => arquivarDemanda(montar("concluida"), ator, c), ErroDeEscopo);
  }
});

test("CA-5: integração confirmada recusa o cancelamento", () => {
  const ag = montar("encerramento", { encerramento: prog({ integracao: { sha: "s2" } }) });
  assert.throws(() => cancelarDemanda(ag, AUDITOR, c), ErroDeRegra);
});

test("CA-6: concluida, arquivada ou cancelada recusa o cancelamento", () => {
  for (const fase of ["concluida", "arquivada", "cancelada"]) {
    assert.throws(() => cancelarDemanda(montar(fase), AUDITOR, c), /já terminou/);
  }
});

test("CA-8: arquivar muda só fase e fase_alterada_em", () => {
  const ag = montar("concluida", { decisoes: [decisao] });
  const r = arquivarDemanda(ag, AUDITOR, c);
  assert.deepEqual(r, { ...ag, demanda: { ...ag.demanda, fase: "arquivada", fase_alterada_em: t1 } });
});

test("CA-9: só concluida pode ser arquivada", () => {
  for (const fase of [...FASES_ANDAMENTO, "arquivada", "cancelada"]) {
    assert.throws(() => arquivarDemanda(montar(fase), AUDITOR, c), /só demanda concluída pode ser arquivada/);
  }
});

test("CA-11 e CA-12: só concluida e arquivada satisfazem a dependência", () => {
  assert.equal(satisfazDependencia("concluida"), true);
  assert.equal(satisfazDependencia("arquivada"), true);
  for (const fase of [...FASES_ANDAMENTO, "cancelada"] as FaseDemanda[]) assert.equal(satisfazDependencia(fase), false);
});

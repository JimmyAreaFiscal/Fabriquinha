import assert from "node:assert/strict";
import { test } from "node:test";
import { type Ator, AUDITOR, FABRIQUINHA } from "./ator.ts";

const EXTERNO: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s1" };
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { arquivarDemanda, cancelarDemanda, satisfazDependencia } from "./cancelamento_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import type { EstadoDemanda } from "./primitivos.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const c = { agora: t1 };
const D = "I-1";
const tk = (ticket_id: number, etapa: string, status: string) => ({
  demanda_id: D,
  ticket_id,
  etapa,
  estado: status,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const montar = (estado: string, m: Record<string, unknown> = {}) =>
  AgregadoDemanda.parse({
    demanda: {
      id: D,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: t0,
      criada_por: EXTERNO,
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    tickets: [tk(1, "entender_e_desenhar", "concluido")],
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
  por: AUDITOR,
  em: t0,
};
const ESTADOS_EM_ANDAMENTO = [
  "entender_e_desenhar",
  "gate_demanda",
  "planejar",
  "gate_planejamento",
  "em_execucao",
  "revisar_demanda",
  "encerrar_demanda",
];

test("CA-1: cancela em qualquer estado de andamento", () => {
  for (const estado of ESTADOS_EM_ANDAMENTO) {
    const r = cancelarDemanda(montar(estado), AUDITOR, c);
    assert.equal(r.demanda.estado, "cancelada");
    assert.equal(r.demanda.estado_alterado_em, t1);
  }
});

test("CA-2: tickets aberto/falhou fecham, em_execucao cancela e concluido fica", () => {
  const ag = montar("em_execucao", {
    tickets: [
      tk(1, "entender_e_desenhar", "concluido"),
      tk(2, "planejar", "aberto"),
      tk(3, "revisar_demanda", "falhou"),
      tk(4, "encerrar_demanda", "em_execucao"),
    ],
  });
  const r = cancelarDemanda(ag, AUDITOR, c);
  assert.deepEqual(
    r.tickets.map((t) => [t.estado, t.estado_alterado_em]),
    [
      ["concluido", t0],
      ["cancelado", t1],
      ["cancelado", t1],
      ["cancelado", t1],
    ],
  );
});

test("cancela com ticket falhou que tem motivo_falha: cancela e preserva o motivo", () => {
  const ag = montar("em_execucao", {
    tickets: [{ ...tk(3, "implementar", "falhou"), motivo_falha: "timeout do modelo" }],
  });
  const r = cancelarDemanda(ag, AUDITOR, c);
  assert.equal(r.demanda.estado, "cancelada");
  assert.deepEqual([r.tickets[0]?.estado, r.tickets[0]?.motivo_falha], ["cancelado", "timeout do modelo"]);
});

test("CA-3 e CA-7: histórico intacto, entrada não mutada e encerramento sem integração relido", () => {
  const ag = montar("encerrar_demanda", { decisoes: [decisao], encerramento: prog({ limpeza_pendente: [] }) });
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
  for (const ator of [{ tipo: "agente" as const, trabalho_id: "E-1" }, FABRIQUINHA, EXTERNO]) {
    assert.throws(() => cancelarDemanda(montar("em_execucao"), ator, c), ErroDeEscopo);
    assert.throws(() => arquivarDemanda(montar("concluida"), ator, c), ErroDeEscopo);
  }
});

test("CA-5: integração confirmada recusa o cancelamento", () => {
  const ag = montar("encerrar_demanda", { encerramento: prog({ integracao: { sha: "s2" } }) });
  assert.throws(() => cancelarDemanda(ag, AUDITOR, c), ErroDeRegra);
});

test("CA-6: concluida, arquivada ou cancelada recusa o cancelamento", () => {
  for (const estado of ["concluida", "arquivada", "cancelada"]) {
    assert.throws(() => cancelarDemanda(montar(estado), AUDITOR, c), /já terminou/);
  }
});

test("CA-8: arquivar muda só estado e estado_alterado_em", () => {
  const ag = montar("concluida", { decisoes: [decisao] });
  const r = arquivarDemanda(ag, AUDITOR, c);
  assert.deepEqual(r, { ...ag, demanda: { ...ag.demanda, estado: "arquivada", estado_alterado_em: t1 } });
});

test("CA-9: só concluida pode ser arquivada", () => {
  for (const estado of [...ESTADOS_EM_ANDAMENTO, "arquivada", "cancelada"]) {
    assert.throws(() => arquivarDemanda(montar(estado), AUDITOR, c), /só no estado concluida/);
  }
});

test("CA-11 e CA-12: só concluida e arquivada satisfazem a dependência", () => {
  assert.equal(satisfazDependencia("concluida"), true);
  assert.equal(satisfazDependencia("arquivada"), true);
  for (const estado of [...ESTADOS_EM_ANDAMENTO, "cancelada"] as EstadoDemanda[])
    assert.equal(satisfazDependencia(estado), false);
});

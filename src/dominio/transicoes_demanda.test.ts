import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, EXTERNO } from "./agregado.ts";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { submeterEvidenciaDemanda } from "./evidencia_demanda.ts";
import { decidirDemanda, editarDemanda, enviarDemanda, registrarDemanda } from "./transicoes_demanda.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const autora = { ferramenta: "claude", sessao: "s1" };
const outra = { ferramenta: "claude", sessao: "s2" };
const reg = { id: "I-1", projeto: "p", titulo: "t", tipo: "funcionalidade", descricao: "d" };
const ev = (tipo: string, extra = {}) => ({ tipo: tipo as never, dados: { v: 1 }, ...extra });

const registrada = () => registrarDemanda(reg, autora, { agora: t0 });
const completa = (): AgregadoDemanda =>
  ["criterios_aceite", "desenho_solucao", "custos_realizados"].reduce(
    (ag, tipo) => submeterEvidenciaDemanda(ag, ev(tipo), autora, t0),
    registrada(),
  );
const enviada = () => enviarDemanda(completa(), autora, { agora: t1 });

test("CA-1: registrar cria a demanda em registro com origem e ticket 1", () => {
  const ag = registrada();
  assert.equal(ag.demanda.fase, "registro");
  assert.equal(ag.demanda.enviada, false);
  assert.equal(ag.demanda.origem_ferramenta, "claude");
  assert.equal(ag.demanda.origem_sessao, "s1");
  assert.equal(ag.demanda.branch, "fabriquinha/I-1");
  assert.deepEqual(
    ag.tickets.map((t) => [t.ticket_id, t.etapa]),
    [[1, "demanda"]],
  );
  assert.throws(() => registrarDemanda({ ...reg, titulo: "" }, autora, { agora: t0 }));
});

test("editar: muda só o informado; recusa vazio, outra sessão e demanda enviada", () => {
  const ag = registrada();
  const novo = editarDemanda(ag, { titulo: "novo" }, autora);
  assert.equal(novo.demanda.titulo, "novo");
  assert.equal(novo.demanda.descricao, "d");
  assert.equal(editarDemanda(ag, { tipo: "problema", descricao: "x" }, autora).demanda.titulo, "t");
  assert.throws(() => editarDemanda(ag, {}, autora));
  assert.throws(() => editarDemanda(ag, { titulo: "x" }, outra), ErroDeEscopo);
  assert.equal(ag.demanda.titulo, "t");
  const env = enviada();
  const antes = structuredClone(env);
  assert.throws(() => editarDemanda(env, { titulo: "x" }, autora), ErroDeRegra); // CA-7
  assert.deepEqual(env, antes);
});

test("CA-6: outra sessão não submete evidência nem envia", () => {
  const ag = registrada();
  assert.throws(() => submeterEvidenciaDemanda(ag, ev("criterios_aceite"), outra, t0), ErroDeEscopo);
  assert.throws(() => enviarDemanda(completa(), outra, { agora: t1 }), ErroDeEscopo);
  assert.deepEqual(ag.evidencias, []);
});

test("CA-2: envio incompleto lista todas as pendências e não muda nada", () => {
  const ag = submeterEvidenciaDemanda(registrada(), ev("desenho_solucao"), autora, t0);
  const antes = structuredClone(ag);
  assert.throws(
    () => enviarDemanda(ag, autora, { agora: t1 }),
    (e: Error) => e instanceof ErroDeRegra && e.message.includes("criterios_aceite, custos_realizados"),
  );
  assert.deepEqual(ag, antes);
});

test("CA-3: envio completo congela e vai a aprovacao_demanda; reenvio é recusado", () => {
  const env = enviada();
  assert.equal(env.demanda.enviada, true);
  assert.equal(env.demanda.fase, "aprovacao_demanda");
  assert.equal(env.demanda.fase_alterada_em, t1);
  assert.throws(() => enviarDemanda(env, autora, { agora: t1 }), ErroDeRegra);
  assert.throws(() => submeterEvidenciaDemanda(env, ev("criterios_aceite"), autora, t1), ErroDeRegra);
});

test("CA-8: depois do envio entram custos, decisão e evidência de ticket sem mexer na definição", () => {
  const env = enviada();
  const definicao = env.evidencias.filter((e) => e.tipo !== "custos_realizados");
  const ag = submeterEvidenciaDemanda(env, ev("custos_realizados"), outra, t1);
  const ag2 = submeterEvidenciaDemanda(ag, ev("mensagem_pr", { ticket_id: 1 }), outra, t1);
  assert.deepEqual(
    ag2.evidencias.filter((e) => e.tipo !== "custos_realizados" && e.ticket_id === undefined),
    definicao,
  );
  assert.equal(ag2.demanda.enviada, true);
  assert.equal(decidirDemanda(ag2, { aprovado: true }, AUDITOR, { agora: t1 }).decisoes.length, 1);
});

test("CA-4: o Auditor aprova e a demanda vai a planejamento", () => {
  const env = enviada();
  const ag = decidirDemanda(env, { aprovado: true, nota: 5 }, AUDITOR, { agora: t1 });
  assert.equal(ag.demanda.fase, "planejamento");
  assert.deepEqual(ag.decisoes[0], {
    demanda_id: "I-1",
    ticket_id: 1,
    decisao_id: 1,
    resultado: "aprovado",
    nota: 5,
    por: "auditor",
    em: t1,
  });
  assert.equal(ag.tickets[0]?.status, "concluido");
  assert.equal(env.demanda.fase, "aprovacao_demanda");
});

test("CA-5: recusa exige motivo, registra e cancela sem novo ticket", () => {
  const env = enviada();
  assert.throws(() => decidirDemanda(env, { aprovado: false }, AUDITOR, { agora: t1 }));
  const ag = decidirDemanda(env, { aprovado: false, motivo: "fora do escopo" }, AUDITOR, { agora: t1 });
  assert.equal(ag.demanda.fase, "cancelada");
  assert.equal(ag.decisoes[0]?.resultado, "recusado");
  assert.equal(ag.decisoes[0].motivo, "fora do escopo");
  assert.equal(ag.tickets.length, 1);
  assert.equal(ag.tickets[0]?.status, "cancelado");
});

test("decidir: só o Auditor, só em aprovacao_demanda, e precisa do ticket da demanda", () => {
  assert.throws(() => decidirDemanda(enviada(), { aprovado: true }, EXTERNO, { agora: t1 }), ErroDeEscopo);
  assert.throws(() => decidirDemanda(registrada(), { aprovado: true }, AUDITOR, { agora: t1 }), ErroDeRegra);
  const env = enviada();
  const outro = {
    demanda_id: "I-1",
    ticket_id: 2,
    etapa: "planejar" as const,
    status: "aberto" as const,
    status_alterado_em: t0,
  };
  const dois = decidirDemanda({ ...env, tickets: [...env.tickets, outro] }, { aprovado: true }, AUDITOR, { agora: t1 });
  assert.deepEqual(dois.tickets[1], outro);
  const sem = { ...enviada(), tickets: [] };
  assert.throws(() => decidirDemanda(sem, { aprovado: true }, AUDITOR, { agora: t1 }), ErroDeRegra);
});

test("CA-3: o mesmo autor com espaços nas pontas registra, edita, submete e envia", () => {
  const autor = { ferramenta: " codex ", sessao: " sessao-demo-197 " };
  let ag = registrarDemanda(reg, autor, { agora: t0 });
  assert.equal(ag.demanda.origem_ferramenta, "codex");
  ag = editarDemanda(ag, { titulo: "novo" }, autor);
  for (const tipo of ["criterios_aceite", "desenho_solucao", "custos_realizados"]) {
    ag = submeterEvidenciaDemanda(ag, ev(tipo), autor, t0);
  }
  assert.equal(enviarDemanda(ag, autor, { agora: t1 }).demanda.enviada, true);
  assert.throws(() => editarDemanda(ag, { titulo: "x" }, { ...autor, sessao: " outra " }), ErroDeEscopo);
});

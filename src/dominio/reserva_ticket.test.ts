import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "./agregado.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { reservarTicket } from "./reserva_ticket.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const tk = (ticket_id: number, rodada_id: number | undefined, status = "aberto", etapa = "implementar") => ({
  demanda_id: "I-1",
  ticket_id,
  rodada_id,
  etapa,
  status,
  status_alterado_em: t0,
});
const rd = (rodada_id: number, fase = "desenvolvimento") => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  fase,
  e2e: false,
  branch: `fabriquinha/I-1-${String(rodada_id)}`,
});
const montar = (extra: Record<string, unknown>, fase = "execucao") =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: t0,
      origem_ferramenta: "f",
      origem_sessao: "s",
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    decisoes: [],
    evidencias: [],
    tickets: [],
    ...extra,
  });
const reservar = (ag: AgregadoDemanda, ticket_id: number, pred = true) =>
  reservarTicket(ag, { ticket_id }, FABRIQUINHA, { agora: t1 }, pred);
const status = (ag: AgregadoDemanda, id: number) => ag.tickets.find((t) => t.ticket_id === id)?.status;
/** Recusa citando o endereço público `trecho`, nunca `T-n`; o agregado de entrada segue intacto. */
const recusa = (ag: AgregadoDemanda, id: number, trecho: RegExp, pred = true) => {
  const antes = structuredClone(ag);
  assert.throws(
    () => reservar(ag, id, pred),
    (e) => e instanceof ErroDeRegra && trecho.test(e.message) && !/T-\d/.test(e.message),
  );
  assert.deepEqual(ag, antes);
};

test("CA-1: reserva o ticket elegível da rodada em desenvolvimento", () => {
  const ag = montar({ rodadas: [rd(1)], tickets: [tk(2, 1)] });
  const novo = reservar(ag, 2);
  assert.equal(status(novo, 2), "em_execucao");
  assert.equal(novo.tickets[0]?.status_alterado_em, t1);
  assert.equal(status(ag, 2), "aberto");
});

test("CA-2: reserva o ticket de planejar com as predecessoras satisfeitas", () => {
  const ag = montar({ tickets: [tk(1, undefined, "aberto", "planejar")] }, "planejamento");
  assert.equal(status(reservar(ag, 1), 1), "em_execucao");
});

test("CA-3: o agente não reserva", () => {
  const ag = montar({ rodadas: [rd(1)], tickets: [tk(2, 1)] });
  assert.throws(
    () => reservarTicket(ag, { ticket_id: 2 }, { tipo: "agente" } as never, { agora: t1 }, true),
    (e) => e instanceof ErroDeEscopo && e.message.includes("só a Fabriquinha pode reservar o ticket"),
  );
  assert.throws(() => reservarTicket(ag, { ticket_id: 2 }, AUDITOR, { agora: t1 }, true), ErroDeEscopo);
  assert.equal(status(ag, 2), "aberto");
});

test("CA-4: reservar de novo é recusado citando o endereço e o status", () => {
  recusa(montar({ rodadas: [rd(1)], tickets: [tk(2, 1, "em_execucao")] }), 2, /I-1\.T2 está em_execucao/);
});

test("CA-5: predecessora não satisfeita recusa o planejar", () => {
  recusa(montar({ tickets: [tk(1, undefined, "aberto", "planejar")] }, "planejamento"), 1, /predecessoras/, false);
});

test("CA-6: dependência de ticket não concluído cita o endereço dele", () => {
  const dependencias_ticket = [{ demanda_id: "I-1", ticket_id: 3, depende_ticket_id: 2 }];
  recusa(montar({ rodadas: [rd(1)], tickets: [tk(2, 1), tk(3, 1)], dependencias_ticket }), 3, /I-1\.T2/);
});

test("CA-7: outro ticket da rodada em execução cita o endereço dele", () => {
  recusa(montar({ rodadas: [rd(1)], tickets: [tk(2, 1), tk(4, 1, "em_execucao")] }), 2, /I-1\.T4 da rodada/);
});

test("rodada dependente não concluída cita a rodada", () => {
  const dependencias_rodada = [{ demanda_id: "I-1", rodada_id: 2, depende_rodada_id: 1 }];
  recusa(
    montar({ rodadas: [rd(1), rd(2)], tickets: [tk(2, 1, "concluido"), tk(3, 2)], dependencias_rodada }),
    3,
    /I-1\.R1/,
  );
});

test("ticket global ocupado bloqueia a execução", () => {
  const ag = montar({ rodadas: [rd(1)], tickets: [tk(2, 1), tk(5, undefined, "falhou", "resolver_conflito")] });
  recusa(ag, 2, /I-1\.T5 da demanda está falhou/);
});

test("ticket aberto de menor id vem antes", () => {
  recusa(montar({ rodadas: [rd(1)], tickets: [tk(2, 1), tk(3, 1)] }), 3, /I-1\.T2 aberto vem antes/);
});

test("etapa fora da fase da rodada cai no motivo geral", () => {
  recusa(montar({ rodadas: [rd(1, "revisao")], tickets: [tk(2, 1)] }), 2, /etapa implementar não é a do trabalho/);
});

test("demanda encerrada e ticket inexistente são recusados", () => {
  assert.throws(() => reservar(montar({ tickets: [tk(1, undefined)] }, "concluida"), 1), /I-1 está em concluida/);
  assert.throws(() => reservar(montar({}), 9), /I-1\.T9 não existe/);
});

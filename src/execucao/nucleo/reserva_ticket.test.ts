import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../../fluxo/nucleo/ator.ts";
import { AgregadoDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { iniciarTentativaDoTicket, reservarTicket } from "./reserva_ticket.ts";
import { Endereco } from "../../demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const tk = (ticket_id: number, rodada_id: number | undefined, status = "aberto", etapa = "implementar") => ({
  demanda_id: "I-1",
  ticket_id,
  rodada_id,
  etapa,
  estado: status,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const rd = (rodada_id: number, estado = "implementar") => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/I-1-${String(rodada_id)}`,
});
const montar = (extra: Record<string, unknown>, estado = "em_execucao") =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: t0,
      criada_por: { tipo: "externo", ferramenta: "f", sessao: "s" },
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
const status = (ag: AgregadoDemanda, id: number) => ag.tickets.find((t) => t.ticket_id === id)?.estado;
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
  assert.equal(novo.tickets[0]?.estado_alterado_em, t1);
  assert.equal(status(ag, 2), "aberto");
});

test("CA-2: reserva o ticket de planejar com as predecessoras satisfeitas", () => {
  const ag = montar({ tickets: [tk(1, undefined, "aberto", "planejar")] }, "planejar");
  assert.equal(status(reservar(ag, 1), 1), "em_execucao");
});

test("CA-3: o agente não reserva", () => {
  const ag = montar({ rodadas: [rd(1)], tickets: [tk(2, 1)] });
  assert.throws(
    () => reservarTicket(ag, { ticket_id: 2 }, { tipo: "agente", trabalho_id: "E-1" }, { agora: t1 }, true),
    (e) => e instanceof ErroDeEscopo && e.message.includes("só a Fabriquinha pode reservar o ticket"),
  );
  assert.throws(() => reservarTicket(ag, { ticket_id: 2 }, AUDITOR, { agora: t1 }, true), ErroDeEscopo);
  assert.equal(status(ag, 2), "aberto");
});

test("CA-4: reservar de novo é rejeitado citando o estado atual", () => {
  recusa(montar({ rodadas: [rd(1)], tickets: [tk(2, 1, "em_execucao")] }), 2, /o estado atual é em_execucao/);
});

test("CA-5: predecessora não satisfeita recusa o planejar", () => {
  recusa(montar({ tickets: [tk(1, undefined, "aberto", "planejar")] }, "planejar"), 1, /predecessoras/, false);
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

test("etapa fora do estado da rodada cai no motivo geral", () => {
  recusa(
    montar({ rodadas: [rd(1, "revisar_rodada")], tickets: [tk(2, 1)] }),
    2,
    /etapa implementar não é a do trabalho/,
  );
});

test("ticket da demanda fora da etapa do estado cai no motivo geral, sem dependência de rodada", () => {
  recusa(
    montar({ tickets: [tk(2, undefined, "aberto", "revisar_demanda")] }),
    2,
    /etapa revisar_demanda não é a do trabalho/,
  );
});

test("demanda encerrada e ticket inexistente são rejeitados", () => {
  assert.throws(() => reservar(montar({ tickets: [tk(1, undefined)] }, "concluida"), 1), /I-1 está em concluida/);
  assert.throws(() => reservar(montar({}), 9), /I-1\.T9 não existe/);
});

test("iniciar Tentativa abre uma só por ticket aberto ou em execução, com processo e sem mutar o agregado", () => {
  for (const estado of ["aberto", "em_execucao"]) {
    const agregado = montar({ tickets: [tk(2, undefined, estado)] });
    const iniciado = iniciarTentativaDoTicket(agregado, { ticket_id: 2, processo_id: "exec-1" }, FABRIQUINHA, {
      agora: t1,
    });
    assert.deepEqual(iniciado.tentativas, [
      { ticket: Endereco.doTicket("I-1", 2), numero: 1, processo_id: "exec-1", inicio: t1 },
    ]);
    assert.deepEqual(agregado.tentativas, []);
    assert.deepEqual(iniciado.tickets, agregado.tickets);
    const retomado = iniciarTentativaDoTicket(iniciado, { ticket_id: 2, processo_id: "exec-2" }, FABRIQUINHA, {
      agora: t1,
    });
    assert.deepEqual(retomado, iniciado);
  }
});

test("iniciar Tentativa recusa ticket falho, concluído ou cancelado, ator indevido, processo vazio e ticket inexistente", () => {
  for (const estado of ["falhou", "concluido", "cancelado"]) {
    const agregado = montar({ tickets: [tk(2, undefined, estado)] });
    assert.throws(
      () => iniciarTentativaDoTicket(agregado, { ticket_id: 2, processo_id: "exec-1" }, FABRIQUINHA, { agora: t1 }),
      ErroDeRegra,
    );
    assert.deepEqual(agregado.tentativas, []);
  }
  const agregado = montar({ tickets: [tk(2, undefined)] });
  assert.throws(
    () => iniciarTentativaDoTicket(agregado, { ticket_id: 2, processo_id: "exec-1" }, AUDITOR, { agora: t1 }),
    ErroDeEscopo,
  );
  assert.throws(() =>
    iniciarTentativaDoTicket(agregado, { ticket_id: 2, processo_id: "" }, FABRIQUINHA, { agora: t1 }),
  );
  assert.throws(
    () => iniciarTentativaDoTicket(agregado, { ticket_id: 9, processo_id: "exec-1" }, FABRIQUINHA, { agora: t1 }),
    /I-1\.T9 não existe/,
  );
});

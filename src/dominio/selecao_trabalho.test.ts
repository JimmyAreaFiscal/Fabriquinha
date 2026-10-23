import assert from "node:assert/strict";
import { test } from "node:test";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { selecionarTrabalho } from "./selecao_trabalho.ts";

const t0 = "2026-01-01T00:00:00Z";
const tk = (ticket_id: number, rodada_id: number | undefined, status = "aberto") => ({
  demanda_id: "I-1",
  ticket_id,
  rodada_id,
  etapa: "implementar",
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
const ids = (extra: Record<string, unknown>, fase?: string) =>
  selecionarTrabalho(montar(extra, fase)).map((t) => t.ticket_id);
const dep = (rodada_id: number, depende_rodada_id: number) => ({ demanda_id: "I-1", rodada_id, depende_rodada_id });

test("fora de execucao nada é elegível", () => {
  assert.deepEqual(ids({ rodadas: [rd(1)], tickets: [tk(2, 1)] }, "planejamento"), []);
});

test("CA-8: rodada com dependência não concluída não devolve ticket; concluída libera", () => {
  const base = {
    rodadas: [rd(1), rd(2)],
    tickets: [tk(2, 1, "em_execucao"), tk(3, 2)],
    dependencias_rodada: [dep(2, 1)],
  };
  assert.deepEqual(ids(base), []);
  assert.deepEqual(ids({ ...base, rodadas: [rd(1, "concluida"), rd(2)] }), [3]);
});

test("CA-9: rodadas independentes saem juntas, com o menor ticket aberto de cada; dependência de ticket respeitada", () => {
  const dt = (ticket_id: number, depende_ticket_id: number) => ({ demanda_id: "I-1", ticket_id, depende_ticket_id });
  assert.deepEqual(ids({ rodadas: [rd(1), rd(2)], tickets: [tk(5, 1), tk(4, 1), tk(7, 2), tk(6, 2)] }), [4, 6]);
  assert.deepEqual(
    ids({
      rodadas: [rd(1)],
      tickets: [tk(4, 1), tk(5, 1, "concluido"), tk(6, 1)],
      dependencias_ticket: [dt(4, 6), dt(6, 5)],
    }),
    [6],
  );
});

test("CA-10: ticket em_execucao na rodada impede outro; CA-11: falha bloqueia só a rodada", () => {
  assert.deepEqual(ids({ rodadas: [rd(1)], tickets: [tk(2, 1, "em_execucao"), tk(3, 1)] }), []);
  assert.deepEqual(ids({ rodadas: [rd(1), rd(2)], tickets: [tk(2, 1, "falhou"), tk(3, 1), tk(4, 2)] }), [4]);
});

test("CA-12: ticket global falhou bloqueia a demanda", () => {
  assert.deepEqual(ids({ rodadas: [rd(1)], tickets: [tk(2, undefined, "falhou"), tk(3, 1)] }), []);
});

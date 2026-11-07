import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "./ator.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { selecionarTrabalho, selecionarTrabalhoGlobal } from "./selecao_trabalho.ts";
import { concluirSessaoRodada, registrarCorrecoesSessao, reprovarPullRequestRodada } from "./transicoes_rodada.ts";

const t0 = "2026-01-01T00:00:00Z";
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
const ids = (extra: Record<string, unknown>, estado?: string, pred = true) =>
  selecionarTrabalho(montar(extra, estado), pred).map((t) => t.ticket_id);
const dep = (rodada_id: number, depende_rodada_id: number) => ({ demanda_id: "I-1", rodada_id, depende_rodada_id });

test("fora de execucao nada é elegível", () => {
  assert.deepEqual(ids({ rodadas: [rd(1)], tickets: [tk(2, 1)] }, "planejar"), []);
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

test("CA-15: só rodadas em desenvolvimento devolvem ticket, qualquer que seja a outra estado", () => {
  for (const estado of ["revisar_rodada", "encerrar_rodada", "gate_pr", "ajustar_resultado", "concluida"]) {
    assert.deepEqual(ids({ rodadas: [rd(1, estado), rd(2)], tickets: [tk(2, 1), tk(3, 2)] }), [3], estado);
  }
});

test("CA-3: em desenvolvimento só o implementar é elegível; ajustar_resultado nunca sai", () => {
  const rodadas = [rd(1)];
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, 1, "aberto", "revisar_rodada")] }), []);
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, 1, "aberto", "encerrar_rodada"), tk(3, 1)] }), [3]);
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, 1, "aberto", "ajustar_resultado")] }), []);
});

test("CA-2, CA-4: rodada em revisao devolve revisar_rodada; em encerramento, encerrar_rodada", () => {
  assert.deepEqual(ids({ rodadas: [rd(1, "revisar_rodada")], tickets: [tk(2, 1, "aberto", "revisar_rodada")] }), [2]);
  assert.deepEqual(ids({ rodadas: [rd(1, "encerrar_rodada")], tickets: [tk(2, 1, "aberto", "encerrar_rodada")] }), [2]);
  assert.deepEqual(ids({ rodadas: [rd(1, "revisar_rodada")], tickets: [tk(2, 1, "aberto", "encerrar_rodada")] }), []);
});

test("CA-1, CA-17: planejar aberto sai com predecessoras satisfeitas; pendentes não devolvem", () => {
  const extra = { tickets: [tk(5, undefined, "aberto", "planejar"), tk(4, undefined, "aberto", "planejar")] };
  assert.deepEqual(ids(extra, "planejar"), [4]);
  assert.deepEqual(ids(extra, "planejar", false), []);
});

const encerrando = (resolver: string, conflito = true) => ({
  rodadas: [rd(1, "concluida")],
  tickets: [tk(2, undefined, "aberto", "encerrar_demanda"), tk(3, undefined, resolver, "resolver_conflito")],
  encerramento: {
    demanda_id: "I-1",
    branch: "fabriquinha/I-1",
    base: "develop",
    limpeza_pendente: [],
    ...(conflito ? { conflito_pendente: { ticket_id: 3 } } : {}),
  },
});

test("CA-5, CA-6, CA-7: encerrar_demanda só sem conflito pendente; resolver_conflito aberto sai", () => {
  assert.deepEqual(ids(encerrando("concluido"), "encerrar_demanda"), [2]);
  assert.deepEqual(ids(encerrando("concluido", false), "encerrar_demanda"), [2]);
  assert.deepEqual(ids(encerrando("aberto"), "encerrar_demanda"), [3]);
  assert.deepEqual(ids(encerrando("em_execucao"), "encerrar_demanda"), []);
});

test("CA-8, CA-9: revisar_demanda só com todas as rodadas concluídas", () => {
  const tickets = [tk(2, undefined, "aberto", "revisar_demanda")];
  assert.deepEqual(ids({ rodadas: [rd(1, "concluida"), rd(2)], tickets }, "revisar_demanda"), []);
  assert.deepEqual(ids({ rodadas: [rd(1, "concluida"), rd(2, "concluida")], tickets }, "revisar_demanda"), [2]);
});

test("na mesma demanda, tickets globais saem por id", () => {
  const ag = {
    ...encerrando("aberto", false),
    tickets: [tk(5, undefined, "aberto", "resolver_conflito"), tk(2, undefined, "aberto", "encerrar_demanda")],
  };
  const d = demandaNum("I-1", ag, "encerrar_demanda");
  assert.deepEqual(
    selecionarTrabalhoGlobal([d], { limite: 9, emAndamento: 0 }).map((t) => t.ticket_id),
    [2, 5],
  );
});

test("demanda não sai fora dos estados com etapa automática", () => {
  assert.deepEqual(ids({ tickets: [tk(2, undefined, "aberto", "entender_e_desenhar")] }, "entender_e_desenhar"), []);
});

const demandaNum = (id: string, extra: Record<string, unknown>, estado = "em_execucao") => {
  const ag = montar(extra, estado);
  return {
    agregado: {
      ...ag,
      demanda: { ...ag.demanda, id, branch: `fabriquinha/${id}` },
      rodadas: ag.rodadas.map((r) => ({ ...r, demanda_id: id })),
      tickets: ag.tickets.map((t) => ({ ...t, demanda_id: id })),
    },
    predecessoras_satisfeitas: true,
  };
};
const umImplementar = { rodadas: [rd(1)], tickets: [tk(2, 1)] };
const globais = (n: number, limite: number, emAndamento: number) =>
  selecionarTrabalhoGlobal(
    Array.from({ length: n }, (_, i) => demandaNum(`I-${String(i + 1)}`, umImplementar)),
    { limite, emAndamento },
  ).map((t) => t.demanda_id);

test("CA-13, CA-14: o limite global descontado o que está em andamento; sem vagas, nada", () => {
  assert.deepEqual(globais(3, 3, 1), ["I-1", "I-2"]);
  assert.deepEqual(globais(2, 2, 2), []);
  assert.deepEqual(globais(2, 1, 5), []);
});

test("CA-15: desempate por demanda (numérica), rodada e ticket", () => {
  const i1 = demandaNum("I-1", { rodadas: [rd(1), rd(2)], tickets: [tk(9, 2), tk(7, 1)] });
  const i2 = demandaNum("I-2", { rodadas: [rd(1)], tickets: [tk(3, 1)] });
  const i10 = demandaNum("I-10", umImplementar);
  const sel = selecionarTrabalhoGlobal([i10, i2, i1], { limite: 3, emAndamento: 1 });
  assert.deepEqual(
    sel.map((t) => [t.demanda_id, t.ticket_id]),
    [
      ["I-1", 7],
      ["I-1", 9],
    ],
  );
  const mesmoNumero = selecionarTrabalhoGlobal([demandaNum("X-1", umImplementar), demandaNum("A-1", umImplementar)], {
    limite: 2,
    emAndamento: 0,
  });
  assert.deepEqual(
    mesmoNumero.map((t) => t.demanda_id),
    ["A-1", "X-1"],
  );
  const global = demandaNum("I-3", { tickets: [tk(1, undefined, "aberto", "planejar")] }, "planejar");
  assert.deepEqual(
    selecionarTrabalhoGlobal([global, i1], { limite: 9, emAndamento: 0 }).map((t) => t.ticket_id),
    [7, 9, 1],
  );
});

test("CA-15: trabalho global aberto não concorre; em execução ou falho bloqueia as rodadas", () => {
  const rodadas = [rd(1), rd(2, "revisar_rodada")];
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, undefined, "aberto", "entender_e_desenhar"), tk(3, 1)] }), [3]);
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, undefined, "em_execucao", "entender_e_desenhar"), tk(3, 1)] }), []);
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, undefined, "falhou", "entender_e_desenhar"), tk(3, 1)] }), []);
});

test("reprovação do PR → sessão sem implementação → correção nova → concluir sessão → seleciona a correção", () => {
  const ref = { demanda_id: "I-1", rodada_id: 1 };
  const ctx = { agora: "2026-01-02T00:00:00Z" };
  const gate = montar({
    rodadas: [rd(1, "gate_pr"), rd(2)],
    tickets: [tk(2, 1, "concluido"), tk(3, 1, "aberto", "encerrar_rodada"), tk(4, 2)],
  });
  const sessao = reprovarPullRequestRodada(gate, { ...ref, ticket_id: 3, motivo: "ajustar" }, AUDITOR, ctx);
  assert.deepEqual(
    selecionarTrabalho(sessao, true).map((t) => t.ticket_id),
    [4],
  );
  const sessaoTicket = sessao.tickets.find((t) => t.etapa === "ajustar_resultado")?.ticket_id ?? 0;
  const corrigida = registrarCorrecoesSessao(
    sessao,
    {
      ...ref,
      ticket_id: sessaoTicket,
      correcoes: [{ demanda_id: "I-1", ticket_id: 1, rodada_id: 1, titulo: "c", descricao: "d" }],
    },
    AUDITOR,
    ctx,
  );
  assert.deepEqual(
    selecionarTrabalho(corrigida, true).map((t) => t.ticket_id),
    [4],
  );
  const volta = concluirSessaoRodada(corrigida, { ...ref, ticket_id: sessaoTicket }, AUDITOR, ctx);
  assert.deepEqual(
    selecionarTrabalho(volta, true).map((t) => t.ticket_id),
    [6, 4],
  );
});

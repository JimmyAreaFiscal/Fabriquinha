import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeRegra } from "./erros.ts";
import {
  criarSessao,
  encerrarExecucao,
  estadoExecucao,
  ExecucaoSessao,
  iniciarExecucao,
  registrarUso,
  retomarSessao,
  Sessao,
  totalDaDemanda,
  totalDaSessao,
  totalDoTicket,
  UsoModeloExecucao,
} from "./sessoes.ts";

const sessao = (id: string, ticket_id = 1, demanda_id = "D-1"): Sessao => ({
  id,
  demanda_id,
  ticket_id,
  modo: "autonomo",
  conversa_referencia: `conv-${id}`,
});
const exec = (id: string, sessao_id: string): ExecucaoSessao => ({ id, sessao_id, inicio: "2026-01-01T10:00:00Z" });
const uso = (execucao_id: string, modelo_nome: string, tokens: number, custo?: number): UsoModeloExecucao => ({
  execucao_id,
  modelo_provedor: "anthropic",
  modelo_nome,
  tokens_entrada: tokens,
  tokens_saida: 1,
  tokens_cache_leitura: 2,
  tokens_cache_escrita: 3,
  custo,
});
const primeiro = <T>(lista: readonly T[]): T => {
  const [item] = lista;
  assert.ok(item);
  return item;
};
const regra = { name: "ErroDeRegra" };

test("CA-1: schema da sessão", () => {
  assert.ok(Sessao.safeParse(sessao("s1")).success);
  assert.ok(!Sessao.safeParse({ ...sessao("s1"), modo: "x" }).success);
  assert.ok(!Sessao.safeParse({ ...sessao("s1"), conversa_referencia: undefined }).success);
  assert.ok(!Sessao.safeParse({ ...sessao("s1"), id: "" }).success);
});

test("CA-2: schemas de execução e uso", () => {
  assert.ok(ExecucaoSessao.safeParse({ ...exec("e1", "s1"), fim: "2026-01-01T11:00:00Z", falha: "erro" }).success);
  assert.ok(!ExecucaoSessao.safeParse({ ...exec("e1", "s1"), inicio: "ontem" }).success);
  assert.ok(UsoModeloExecucao.safeParse(uso("e1", "m", 5)).success);
  assert.ok(UsoModeloExecucao.safeParse(uso("e1", "m", 5, 0.5)).success);
  assert.ok(!UsoModeloExecucao.safeParse(uso("e1", "m", -1)).success);
  assert.ok(!UsoModeloExecucao.safeParse(uso("e1", "m", 5, -1)).success);
  assert.ok(!UsoModeloExecucao.safeParse(uso("e1", "m", 5, Infinity)).success);
  assert.ok(!UsoModeloExecucao.safeParse({ ...uso("e1", "m", 5), modelo_nome: undefined }).success);
});

test("CA-3: dois tickets e duas sessões no mesmo ticket", () => {
  const todas = [sessao("s1"), sessao("s2"), sessao("s3", 2)].reduce<Sessao[]>((a, s) => criarSessao(a, s), []);
  assert.equal(todas.length, 3);
  assert.deepEqual(
    todas.slice(0, 2).map((s) => [s.demanda_id, s.ticket_id]),
    [
      ["D-1", 1],
      ["D-1", 1],
    ],
  );
  assert.throws(() => criarSessao(todas, sessao("s1")), regra);
});

test("CA-4: retomar cria execução distinta e preserva a conversa", () => {
  const sessoes = [sessao("s1")];
  const e1 = encerrarExecucao(iniciarExecucao(sessoes, [], exec("e1", "s1")), "e1", "2026-01-01T11:00:00Z");
  const e2 = retomarSessao(sessoes, e1, exec("e2", "s1"));
  assert.deepEqual(
    e2.map((e) => e.id),
    ["e1", "e2"],
  );
  assert.equal(primeiro(sessoes).conversa_referencia, "conv-s1");
  assert.throws(() => retomarSessao(sessoes, [], exec("e1", "s1")), regra);
});

test("CA-5: recusa segunda execução sem fim, sessão ou id inválidos", () => {
  const sessoes = [sessao("s1"), sessao("s2")];
  const aberta = iniciarExecucao(sessoes, [], exec("e1", "s1"));
  assert.throws(() => iniciarExecucao(sessoes, aberta, exec("e2", "s1")), regra);
  assert.throws(() => retomarSessao(sessoes, aberta, exec("e2", "s1")), regra);
  assert.equal(aberta.length, 1);
  assert.equal(iniciarExecucao(sessoes, aberta, exec("e2", "s2")).length, 2);
  assert.throws(() => iniciarExecucao(sessoes, aberta, exec("e3", "nope")), regra);
  assert.throws(() => iniciarExecucao(sessoes, aberta, exec("e1", "s2")), regra);
});

test("CA-6: fim ausente é não encerrada; encerrar grava fim e falha", () => {
  const aberta = { ...exec("e1", "s1"), falha: "erro" };
  assert.equal(estadoExecucao(aberta), "em_andamento");
  assert.equal(estadoExecucao(exec("e1", "s1")), "em_andamento");
  const ok = primeiro(encerrarExecucao([exec("e1", "s1")], "e1", "2026-01-01T11:00:00Z"));
  assert.equal(estadoExecucao(ok), "sucesso");
  const ruim = primeiro(encerrarExecucao([exec("e1", "s1")], "e1", "2026-01-01T11:00:00Z", "quebrou"));
  assert.deepEqual([ruim.fim, ruim.falha, estadoExecucao(ruim)], ["2026-01-01T11:00:00Z", "quebrou", "falha"]);
  const outras = encerrarExecucao([exec("e0", "s1"), exec("e1", "s1")], "e1", "2026-01-01T11:00:00Z");
  assert.equal(primeiro(outras).fim, undefined);
  assert.throws(() => encerrarExecucao([ok], "e1", "2026-01-01T12:00:00Z"), regra);
  assert.throws(() => encerrarExecucao([], "e1", "2026-01-01T12:00:00Z"), regra);
  assert.ok(new ErroDeRegra("x") instanceof Error);
});

test("CA-7: dois modelos e registro idempotente", () => {
  let usos = registrarUso([], uso("e1", "a", 10));
  usos = registrarUso(usos, uso("e1", "b", 20));
  usos = registrarUso(usos, uso("e1", "a", 15));
  assert.equal(usos.length, 2);
  assert.equal(usos.find((u) => u.modelo_nome === "a")?.tokens_entrada, 15);
  assert.equal(usos.find((u) => u.modelo_nome === "b")?.tokens_entrada, 20);
  assert.throws(() => registrarUso(usos, uso("e1", "a", -1)));
});

test("CA-8: totais sem duplicar execuções e com custo ausente", () => {
  const sessoes = [sessao("s1"), sessao("s2", 2), sessao("s3", 1, "D-2")];
  const execucoes = [exec("e1", "s1"), exec("e2", "s1"), exec("e3", "s2"), exec("e4", "s3")];
  const usos = [
    uso("e1", "a", 10, 1),
    uso("e1", "a", 10, 1), // repetido: conta uma vez
    uso("e2", "a", 20, 2),
    uso("e2", "b", 30), // custo ausente
    uso("e3", "a", 100, 4),
    uso("e4", "a", 1000, 8),
    uso("fantasma", "a", 5000, 16),
  ];
  const s1 = totalDaSessao(sessoes, execucoes, usos, "s1");
  assert.deepEqual(s1, {
    tokens_entrada: 60,
    tokens_saida: 3,
    tokens_cache_leitura: 6,
    tokens_cache_escrita: 9,
    custo_conhecido: 3,
    custo_incompleto: true,
  });
  const ticket = totalDoTicket(sessoes, execucoes, usos, { demanda_id: "D-1", ticket_id: 1 });
  assert.equal(ticket.tokens_entrada, 60);
  const demanda = totalDaDemanda(sessoes, execucoes, usos, "D-1");
  assert.equal(demanda.tokens_entrada, 160);
  assert.equal(demanda.custo_conhecido, 7);
  assert.equal(demanda.custo_incompleto, true);
  const completo = totalDaSessao(sessoes, execucoes, usos, "s2");
  assert.deepEqual([completo.custo_conhecido, completo.custo_incompleto], [4, false]);
});

test("CA-9: tokens e custo não são campos da sessão", () => {
  assert.deepEqual(Object.keys(Sessao.shape).sort(), ["conversa_referencia", "demanda_id", "id", "modo", "ticket_id"]);
});

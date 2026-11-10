import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeRegra } from "./erros.ts";
import {
  criarTrabalho,
  encerrarProcesso,
  ProcessoDoTrabalho,
  iniciarProcesso,
  acumularUso,
  registrarUso,
  retomarTrabalho,
  TrabalhoGerenciado,
  UsoModeloExecucao,
} from "./trabalho_agentico.ts";

const sessao = (id: string, ticket_id = 1, demanda_id = "D-1"): TrabalhoGerenciado => ({
  id,
  demanda_id,
  ticket_id,
  modo: "autonomo",
  conversa_referencia: `conv-${id}`,
});
const exec = (id: string, trabalho_id: string): ProcessoDoTrabalho => ({
  id,
  trabalho_id,
  inicio: "2026-01-01T10:00:00Z",
  falha: false,
});
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
  assert.ok(TrabalhoGerenciado.safeParse(sessao("s1")).success);
  assert.ok(!TrabalhoGerenciado.safeParse({ ...sessao("s1"), modo: "x" }).success);
  assert.ok(!TrabalhoGerenciado.safeParse({ ...sessao("s1"), conversa_referencia: undefined }).success);
  assert.ok(!TrabalhoGerenciado.safeParse({ ...sessao("s1"), id: "" }).success);
});

test("CA-2: schemas de execução e uso", () => {
  const fim = "2026-01-01T11:00:00Z";
  assert.ok(ProcessoDoTrabalho.safeParse({ ...exec("e1", "s1"), fim, falha: true }).success);
  assert.ok(ProcessoDoTrabalho.safeParse({ ...exec("e1", "s1"), fim, falha: false }).success);
  assert.ok(!ProcessoDoTrabalho.safeParse({ ...exec("e1", "s1"), fim, falha: "quebrou" }).success);
  assert.ok(!ProcessoDoTrabalho.safeParse({ ...exec("e1", "s1"), falha: undefined }).success);
  assert.ok(!ProcessoDoTrabalho.safeParse({ ...exec("e1", "s1"), inicio: "ontem" }).success);
  assert.ok(UsoModeloExecucao.safeParse(uso("e1", "m", 5)).success);
  assert.ok(UsoModeloExecucao.safeParse(uso("e1", "m", 5, 0.5)).success);
  assert.ok(!UsoModeloExecucao.safeParse(uso("e1", "m", -1)).success);
  assert.ok(!UsoModeloExecucao.safeParse(uso("e1", "m", 5, -1)).success);
  assert.ok(!UsoModeloExecucao.safeParse(uso("e1", "m", 5, Infinity)).success);
  assert.ok(!UsoModeloExecucao.safeParse({ ...uso("e1", "m", 5), modelo_nome: undefined }).success);
});

test("CA-3: dois tickets e duas sessões no mesmo ticket", () => {
  const todas = [sessao("s1"), sessao("s2"), sessao("s3", 2)].reduce<TrabalhoGerenciado[]>(
    (a, s) => criarTrabalho(a, s),
    [],
  );
  assert.equal(todas.length, 3);
  assert.deepEqual(
    todas.slice(0, 2).map((s) => [s.demanda_id, s.ticket_id]),
    [
      ["D-1", 1],
      ["D-1", 1],
    ],
  );
  assert.throws(() => criarTrabalho(todas, sessao("s1")), regra);
});

test("CA-4: retomar cria execução distinta e preserva a conversa", () => {
  const sessoes = [sessao("s1")];
  const e1 = encerrarProcesso(iniciarProcesso(sessoes, [], exec("e1", "s1")), "e1", "2026-01-01T11:00:00Z", false);
  const e2 = retomarTrabalho(sessoes, e1, exec("e2", "s1"));
  assert.deepEqual(
    e2.map((e) => e.id),
    ["e1", "e2"],
  );
  assert.equal(primeiro(sessoes).conversa_referencia, "conv-s1");
  assert.throws(() => retomarTrabalho(sessoes, [], exec("e1", "s1")), regra);
});

test("CA-5: recusa segunda execução sem fim, sessão ou id inválidos", () => {
  const sessoes = [sessao("s1"), sessao("s2")];
  const aberta = iniciarProcesso(sessoes, [], exec("e1", "s1"));
  assert.throws(() => iniciarProcesso(sessoes, aberta, exec("e2", "s1")), regra);
  assert.throws(() => retomarTrabalho(sessoes, aberta, exec("e2", "s1")), regra);
  assert.equal(aberta.length, 1);
  assert.equal(iniciarProcesso(sessoes, aberta, exec("e2", "s2")).length, 2);
  assert.throws(() => iniciarProcesso(sessoes, aberta, exec("e3", "nope")), regra);
  assert.throws(() => iniciarProcesso(sessoes, aberta, exec("e1", "s2")), regra);
});

test("CA-6: fim ausente é não encerrada; encerrar grava fim e falha", () => {
  const ok = primeiro(encerrarProcesso([exec("e1", "s1")], "e1", "2026-01-01T11:00:00Z", false));
  assert.deepEqual([ok.fim, ok.falha], ["2026-01-01T11:00:00Z", false]);
  const ruim = primeiro(encerrarProcesso([exec("e1", "s1")], "e1", "2026-01-01T11:00:00Z", true));
  assert.deepEqual([ruim.fim, ruim.falha], ["2026-01-01T11:00:00Z", true]);
  const outras = encerrarProcesso([exec("e0", "s1"), exec("e1", "s1")], "e1", "2026-01-01T11:00:00Z", false);
  assert.equal(primeiro(outras).fim, undefined);
  assert.throws(() => encerrarProcesso([ok], "e1", "2026-01-01T12:00:00Z", false), regra);
  assert.throws(() => encerrarProcesso([], "e1", "2026-01-01T12:00:00Z", false), regra);
  assert.ok(new ErroDeRegra("x") instanceof Error);
});

test("CA-2/5/6: fim null é execução não encerrada", () => {
  const sessoes = [sessao("s1")];
  const e1 = { ...exec("e1", "s1"), fim: null };
  assert.ok(ProcessoDoTrabalho.safeParse(e1).success);
  assert.throws(() => iniciarProcesso(sessoes, [e1], exec("e2", "s1")), regra);
  assert.throws(() => retomarTrabalho(sessoes, [e1], exec("e2", "s1")), regra);
  const fechada = primeiro(encerrarProcesso([e1], "e1", "2026-01-01T11:00:00Z", false));
  assert.deepEqual([fechada.fim, fechada.falha], ["2026-01-01T11:00:00Z", false]);
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

test("CA-9: tokens e custo não são campos da sessão", () => {
  assert.deepEqual(Object.keys(TrabalhoGerenciado.shape).sort(), [
    "conversa_referencia",
    "demanda_id",
    "id",
    "modo",
    "ticket_id",
  ]);
});

test("controle da execução: campos opcionais e par do modelo", () => {
  const completa = {
    ...exec("e1", "s1"),
    grupo_processo: 4321,
    configuracao_agente: { modelo: { provedor: "claude-bridge", nome: "claude-sonnet-5-5" }, effort: "high" },
  };
  assert.ok(ProcessoDoTrabalho.safeParse(completa).success);
  assert.ok(
    !ProcessoDoTrabalho.safeParse({ ...completa, configuracao_agente: { modelo: { provedor: "claude-bridge" } } })
      .success,
  );
  assert.ok(
    !ProcessoDoTrabalho.safeParse({ ...completa, configuracao_agente: { modelo: { nome: "claude-sonnet-5-5" } } })
      .success,
  );
  assert.ok(!ProcessoDoTrabalho.safeParse({ ...completa, configuracao_agente: { effort: "turbo" } }).success);
  assert.ok(!ProcessoDoTrabalho.safeParse({ ...completa, grupo_processo: 0 }).success);
  assert.equal("erro" in ProcessoDoTrabalho.shape, false);
});

test("acumularUso soma à mesma chave, e o custo desconhecido de qualquer parcela deixa o total desconhecido", () => {
  const somado = acumularUso([uso("e1", "a", 10, 0.5), uso("e1", "b", 5)], uso("e1", "a", 20, 0.25));
  assert.deepEqual(
    somado.find((u) => u.modelo_nome === "a"),
    {
      ...uso("e1", "a", 30, 0.75),
      tokens_saida: 2,
      tokens_cache_leitura: 4,
      tokens_cache_escrita: 6,
    },
  );
  assert.equal(somado.length, 2);
  assert.equal(acumularUso([uso("e1", "b", 5)], uso("e1", "b", 1, 0.5)).at(-1)?.custo, undefined);
  assert.equal(acumularUso([uso("e1", "a", 1, 0.5)], uso("e1", "a", 1)).at(-1)?.custo, undefined);
  assert.equal(acumularUso([uso("e1", "a", 1)], uso("e2", "a", 1)).length, 2);
});

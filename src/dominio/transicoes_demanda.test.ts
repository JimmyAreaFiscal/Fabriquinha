import assert from "node:assert/strict";
import { test } from "node:test";
import { type Ator, AUDITOR, EXTERNO } from "./agregado.ts";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { submeterEvidenciaDemanda } from "./evidencia_demanda.ts";
import {
  confirmarAprovacaoPlanejamento,
  decidirDemanda,
  editarDemanda,
  enviarDemanda,
  reabrirTicket,
  registrarDemanda,
  registrarFalhaTicket,
  reprovarPlanejamento,
  submeterPlano,
} from "./transicoes_demanda.ts";

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

const t2 = "2026-01-03T00:00:00Z";
const agente: Ator = { tipo: "agente", execucao: 1, ticket: 2 };
const criterios = { criterios: [{ id: "CA-1" }, { id: "CA-2" }] };
const planoV = (m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  criterios: ["CA-1"],
  rodadas: [
    { demanda_id: "I-1", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"] },
    { demanda_id: "I-1", rodada_id: 2, titulo: "r2", e2e: true, depende: [{ demanda_id: "I-1", rodada_id: 1 }] },
  ],
  tickets: [
    { demanda_id: "I-1", ticket_id: 2, titulo: "b", descricao: "d", rodada_id: 1, caminhos: ["src/b.ts"] },
    {
      demanda_id: "I-1",
      ticket_id: 1,
      titulo: "a",
      descricao: "d",
      rodada_id: 1,
      modelo_provedor: "p",
      modelo_nome: "m",
      effort: "high",
    },
    {
      demanda_id: "I-1",
      ticket_id: 3,
      titulo: "c",
      descricao: "d",
      rodada_id: 2,
    },
  ],
  ...m,
});
const emPlanejamento = (): AgregadoDemanda => {
  const definida = ["criterios_aceite", "desenho_solucao", "custos_realizados"].reduce(
    (ag, tipo) =>
      submeterEvidenciaDemanda(ag, ev(tipo, tipo === "criterios_aceite" ? { dados: criterios } : {}), autora, t0),
    registrada(),
  );
  const aprovada = decidirDemanda(enviarDemanda(definida, autora, { agora: t1 }), { aprovado: true }, AUDITOR, {
    agora: t1,
  });
  return {
    ...aprovada,
    tickets: [
      ...aprovada.tickets,
      { demanda_id: "I-1", ticket_id: 2, etapa: "planejar", status: "em_execucao", status_alterado_em: t1 },
    ],
  };
};
const submetido = () => submeterPlano(emPlanejamento(), planoV(), agente, { agora: t2 });

test("CA-1: o agente submete o plano; vira evidência do ticket e a demanda vai a aprovacao_planejamento", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const novo = submeterPlano(ag, planoV(), agente, { agora: t2 });
  assert.deepEqual(ag, antes);
  assert.equal(novo.demanda.fase, "aprovacao_planejamento");
  assert.equal(novo.evidencias.filter((e) => e.tipo === "plano" && e.ticket_id === 2).length, 1);
  assert.deepEqual(novo.rodadas, []);
  assert.equal(novo.tickets.length, 2);
});

test("CA-2: ticket de implementação sem rodada é recusado na submissão, sem mutação", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const plano = planoV();
  const { rodada_id: _, ...semRodada } = plano.tickets[2] as Record<string, unknown>;
  const e = planoV({
    tickets: [plano.tickets[0], plano.tickets[1], semRodada, { ...semRodada, ticket_id: 9, rodada_id: 2 }],
  });
  assert.throws(() => submeterPlano(ag, e, agente, { agora: t2 }), /não têm rodada/);
  const vazia = planoV({ tickets: [plano.tickets[0], plano.tickets[1]] });
  assert.throws(() => submeterPlano(ag, vazia, agente, { agora: t2 }), /rodada 2 não tem ticket/);
  assert.deepEqual(ag, antes);
});

test("CA-2: caminho absoluto Windows com barras normais é recusado na submissão, sem mutação", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const plano = planoV();
  for (const caminho of ["C:/fora/segredo.ts", "c:/fora/segredo.ts"]) {
    const e = planoV({ tickets: [{ ...plano.tickets[0], caminhos: [caminho] }, ...plano.tickets.slice(1)] });
    assert.throws(() => submeterPlano(ag, e, agente, { agora: t2 }), /caminho relativo/);
  }
  assert.deepEqual(ag, antes);
});

test("CA-2 e CA-3: submissão recusada sem mutação", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const falha = (e: unknown, ator: Ator = agente, base = ag) => {
    assert.throws(() => submeterPlano(base, e, ator, { agora: t2 }));
  };
  falha(
    planoV({ rodadas: [], tickets: [{ demanda_id: "I-1", ticket_id: 1, titulo: "a", descricao: "d", rodada_id: 5 }] }),
  );
  falha(planoV({ demanda_id: "I-2", rodadas: [], tickets: [] }));
  falha(planoV({ criterios: ["CA-9"] }));
  falha(planoV({ criterios: ["CA-1"] }), { tipo: "auditor" });
  falha(planoV({ criterios: ["CA-1"] }), { tipo: "agente", execucao: 1, ticket: 1 });
  falha(planoV(), agente, enviada());
  falha(planoV(), agente, submetido());
  falha(planoV(), agente, { ...ag, tickets: [ag.tickets[0] as never] });
  assert.deepEqual(ag, antes);
  const semDefinicao = { ...ag, evidencias: [] };
  assert.throws(() => submeterPlano(semDefinicao, planoV(), agente, { agora: t2 }), /CA-1/);
  const malFormada = { ...ag, evidencias: ag.evidencias.map((e) => ({ ...e, dados: { x: 1 } })) };
  assert.throws(() => submeterPlano(malFormada, planoV(), agente, { agora: t2 }), /CA-1/);
});

test("CA-4 e CA-5: reprovar exige Auditor e motivo; registra, volta a planejamento e preserva ticket e plano", () => {
  const ag = submetido();
  const antes = structuredClone(ag);
  assert.throws(() => reprovarPlanejamento(ag, { motivo: "x" }, EXTERNO, { agora: t2 }), ErroDeEscopo);
  assert.throws(() => reprovarPlanejamento(ag, { motivo: " " }, AUDITOR, { agora: t2 }));
  assert.throws(() => reprovarPlanejamento(ag, {}, AUDITOR, { agora: t2 }));
  assert.throws(() => reprovarPlanejamento(emPlanejamento(), { motivo: "x" }, AUDITOR, { agora: t2 }), ErroDeRegra);
  const semPlano = { ...ag, evidencias: ag.evidencias.filter((e) => e.tipo !== "plano") };
  assert.throws(() => reprovarPlanejamento(semPlano, { motivo: "x" }, AUDITOR, { agora: t2 }), /plano submetido/);
  assert.deepEqual(ag, antes);
  const novo = reprovarPlanejamento(ag, { motivo: "falta teste" }, AUDITOR, { agora: t2 });
  assert.equal(novo.demanda.fase, "planejamento");
  assert.deepEqual(novo.decisoes.at(-1), {
    demanda_id: "I-1",
    ticket_id: 2,
    decisao_id: 1,
    resultado: "recusado",
    motivo: "falta teste",
    por: "auditor",
    em: t2,
  });
  assert.deepEqual(novo.tickets, ag.tickets);
  assert.deepEqual(novo.evidencias, ag.evidencias);
  // a mesma sessão retoma e resubmete, substituindo o plano
  const outro = submeterPlano(novo, planoV(), agente, { agora: t2 });
  assert.equal(outro.evidencias.filter((e) => e.tipo === "plano").length, 1);
});

test("decisao_id é local ao ticket: reprovações sucessivas avançam e a aprovação segue a sequência", () => {
  const ag = submetido();
  const r1 = reprovarPlanejamento(ag, { motivo: "a" }, AUDITOR, { agora: t2 });
  const r2 = reprovarPlanejamento(submeterPlano(r1, planoV(), agente, { agora: t2 }), { motivo: "b" }, AUDITOR, {
    agora: t2,
  });
  const ok = confirmarAprovacaoPlanejamento(submeterPlano(r2, planoV(), agente, { agora: t2 }), {}, AUDITOR, {
    agora: t2,
  });
  assert.deepEqual(
    ok.decisoes.map((d) => [d.ticket_id, d.decisao_id]),
    [
      [1, 1],
      [2, 1],
      [2, 2],
      [2, 3],
    ],
  );
  assert.deepEqual(ok.decisoes.slice(0, 1), ag.decisoes);
});

test("CA-6: sem a confirmação nada é criado; só o Auditor, na fase certa e com plano, confirma", () => {
  const ag = submetido();
  assert.equal(ag.decisoes.length, 1);
  assert.equal(ag.rodadas.length, 0);
  assert.throws(() => confirmarAprovacaoPlanejamento(ag, {}, agente, { agora: t2 }), ErroDeEscopo);
  assert.throws(() => confirmarAprovacaoPlanejamento(ag, { nota: 9 }, AUDITOR, { agora: t2 }));
  assert.throws(() => confirmarAprovacaoPlanejamento(emPlanejamento(), {}, AUDITOR, { agora: t2 }), ErroDeRegra);
  const semPlano = { ...ag, evidencias: ag.evidencias.filter((e) => e.tipo !== "plano") };
  assert.throws(() => confirmarAprovacaoPlanejamento(semPlano, {}, AUDITOR, { agora: t2 }), /plano submetido/);
});

test("CA-7: a confirmação materializa rodadas, tickets, caminhos, dependências e vai a execucao", () => {
  const base = submetido();
  const plano = planoV({
    criterios: ["CA-1", "CA-2"],
    rodadas: [
      { demanda_id: "I-1", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"] },
      { demanda_id: "I-1", rodada_id: 2, titulo: "r2", e2e: true, depende: [{ demanda_id: "I-1", rodada_id: 1 }] },
    ],
    tickets: [
      { demanda_id: "I-1", ticket_id: 5, titulo: "b", descricao: "d", rodada_id: 2, caminhos: ["src/b.ts"] },
      {
        demanda_id: "I-1",
        ticket_id: 4,
        titulo: "a",
        descricao: "d",
        rodada_id: 2,
        depende: [],
        modelo_provedor: "p",
        modelo_nome: "m",
        effort: "high",
      },
      {
        demanda_id: "I-1",
        ticket_id: 6,
        titulo: "c",
        descricao: "d",
        rodada_id: 2,
        depende: [{ demanda_id: "I-1", ticket_id: 4 }],
      },
      { demanda_id: "I-1", ticket_id: 7, titulo: "d", descricao: "d", rodada_id: 1 },
    ],
  });
  const ag = submeterPlano(emPlanejamento(), plano, agente, { agora: t2 });
  const antes = structuredClone(ag);
  const novo = confirmarAprovacaoPlanejamento(ag, { nota: 4 }, AUDITOR, { agora: t2 });
  assert.deepEqual(ag, antes);
  assert.deepEqual(base.rodadas, []);
  assert.equal(novo.demanda.fase, "execucao");
  assert.deepEqual(
    novo.rodadas.map((r) => [r.rodada_id, r.fase, r.e2e, r.branch]),
    [
      [1, "desenvolvimento", false, "fabriquinha/I-1-1"],
      [2, "desenvolvimento", true, "fabriquinha/I-1-2"],
    ],
  );
  assert.deepEqual(novo.dependencias_rodada, [{ demanda_id: "I-1", rodada_id: 2, depende_rodada_id: 1 }]);
  assert.deepEqual(novo.criterios_citados, [{ demanda_id: "I-1", rodada_id: 1, criterio_id: "CA-1" }]);
  // IDs do plano (4, 5, 6) são renumerados depois dos existentes (1, 2), na mesma ordem
  assert.deepEqual(
    novo.tickets.slice(2).map((t) => [t.ticket_id, t.titulo, t.rodada_id, t.etapa, t.status, t.effort]),
    [
      [3, "a", 2, "implementar", "aberto", "high"],
      [4, "b", 2, "implementar", "aberto", undefined],
      [5, "c", 2, "implementar", "aberto", undefined],
      [6, "d", 1, "implementar", "aberto", undefined],
    ],
  );
  assert.deepEqual(novo.dependencias_ticket, [{ demanda_id: "I-1", ticket_id: 5, depende_ticket_id: 3 }]);
  assert.deepEqual(novo.caminhos_ticket, [{ demanda_id: "I-1", ticket_id: 4, caminho: "src/b.ts" }]);
  assert.equal(novo.tickets[1]?.status, "concluido");
  assert.deepEqual(novo.decisoes.at(-1), {
    demanda_id: "I-1",
    ticket_id: 2,
    decisao_id: 1,
    resultado: "aprovado",
    nota: 4,
    por: "auditor",
    em: t2,
  });
  assert.equal(confirmarAprovacaoPlanejamento(ag, {}, AUDITOR, { agora: t2 }).decisoes.at(-1)?.nota, undefined);
});

const tk2 = (ag: AgregadoDemanda) => ag.tickets.find((t) => t.ticket_id === 2);
const emExecucao = (status: string): AgregadoDemanda => {
  const ag = emPlanejamento();
  return {
    ...ag,
    demanda: { ...ag.demanda, fase: "execucao" },
    tickets: ag.tickets.map((t) => (t.ticket_id === 2 ? { ...t, status: status as never } : t)),
  };
};

test("CA-16: a falha põe o ticket em falhou sem mudar fase nem decisões; recusa outro status e demanda encerrada", () => {
  const ag = emExecucao("em_execucao");
  const novo = registrarFalhaTicket(ag, { ticket_id: 2 }, { agora: t2 });
  assert.equal(tk2(novo)?.status, "falhou");
  assert.equal(tk2(novo)?.status_alterado_em, t2);
  assert.equal(novo.demanda, ag.demanda);
  assert.equal(novo.decisoes, ag.decisoes);
  assert.throws(() => registrarFalhaTicket(novo, { ticket_id: 2 }, { agora: t2 }), ErroDeRegra);
  assert.throws(() => registrarFalhaTicket(ag, { ticket_id: 9 }, { agora: t2 }), ErroDeRegra);
  const fim = { ...ag, demanda: { ...ag.demanda, fase: "concluida" as const } };
  assert.throws(() => registrarFalhaTicket(fim, { ticket_id: 2 }, { agora: t2 }), ErroDeRegra);
});

test("CA-13 a CA-15: só o Auditor reabre, com instrução; volta a aberto com a instrução", () => {
  const ag = emExecucao("falhou");
  assert.throws(() => reabrirTicket(ag, { ticket_id: 2, instrucao: "  " }, AUDITOR, { agora: t2 }));
  assert.throws(() => reabrirTicket(ag, { ticket_id: 2, instrucao: "x" }, agente, { agora: t2 }), ErroDeEscopo);
  assert.throws(() => reabrirTicket(emExecucao("aberto"), { ticket_id: 2, instrucao: "x" }, AUDITOR, { agora: t2 }));
  const novo = reabrirTicket(ag, { ticket_id: 2, instrucao: "tente de novo" }, AUDITOR, { agora: t2 });
  assert.equal(tk2(novo)?.status, "aberto");
  assert.equal(tk2(novo)?.instrucao, "tente de novo");
  assert.equal(novo.decisoes, ag.decisoes);
  assert.equal(tk2(ag)?.status, "falhou");
});

const falhar = (ag: AgregadoDemanda, ticket_id: number) => registrarFalhaTicket(ag, { ticket_id }, { agora: t2 });
const intacto = (fn: () => unknown, ag: AgregadoDemanda) => {
  const antes = structuredClone(ag);
  assert.throws(fn, ErroDeRegra);
  assert.deepEqual(ag, antes);
};

test("T-965: ticket de planejamento falho bloqueia submissão e confirmação até o Auditor reabrir", () => {
  const antes = falhar(emPlanejamento(), 2);
  intacto(() => submeterPlano(antes, planoV(), agente, { agora: t2 }), antes);
  const aberto = falhar(submetido(), 2);
  intacto(() => confirmarAprovacaoPlanejamento(aberto, {}, AUDITOR, { agora: t2 }), aberto);
  assert.equal(aberto.demanda.fase, "aprovacao_planejamento");
  const reaberto = reabrirTicket(antes, { ticket_id: 2, instrucao: "retome" }, AUDITOR, { agora: t2 });
  assert.equal(reaberto.demanda.fase, "planejamento");
  assert.equal(submeterPlano(reaberto, planoV(), agente, { agora: t2 }).demanda.fase, "aprovacao_planejamento");
});

test("T-965: ticket da demanda falho bloqueia envio e decisão até o Auditor reabrir", () => {
  const ag = falhar(completa(), 1);
  intacto(() => enviarDemanda(ag, autora, { agora: t1 }), ag);
  const reaberto = reabrirTicket(ag, { ticket_id: 1, instrucao: "retome" }, AUDITOR, { agora: t1 });
  const env = enviarDemanda(reaberto, autora, { agora: t1 });
  const emCurso = {
    ...env,
    tickets: env.tickets.map((t) => (t.ticket_id === 1 ? { ...t, status: "em_execucao" as const } : t)),
  };
  const falhoNoGate = falhar(emCurso, 1);
  intacto(() => decidirDemanda(falhoNoGate, { aprovado: true }, AUDITOR, { agora: t2 }), falhoNoGate);
});

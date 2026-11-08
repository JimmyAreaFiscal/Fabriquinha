import assert from "node:assert/strict";
import { test } from "node:test";
import { clonarAgregadoDemanda as structuredClone } from "../../apoio-testes/clonar_agregado_demanda.ts";
import { type Ator, AUDITOR, FABRIQUINHA } from "./ator.ts";

const EXTERNO: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s1" };
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { Endereco } from "./item_de_trabalho.ts";
import {
  comTentativaAberta,
  desdeAReabertura,
  falhaQueExigeOAuditor,
  falhaPorServicoReiniciado,
  motivoDaFalhaDoTicket,
  POLITICA_DE_TENTATIVAS,
  tentativasDoTicket,
} from "./tentativa.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { submeterEvidenciaDemanda } from "./evidencia_demanda.ts";
import { selecionarTrabalho } from "./selecao_trabalho.ts";
import {
  confirmarAprovacaoPlanejamento,
  decidirDemanda,
  editarDemanda,
  enviarDemanda,
  devolverTicket,
  iniciarRevisaoDemanda,
  mudarTicket,
  reabrirTicket,
  retomarTicketFalhoPorInfraestrutura,
  registrarDemanda,
  registrarFalhaTicket,
  registrarRevisaoDemanda,
  reprovarPlanejamento,
  submeterPlano,
} from "./transicoes_demanda.ts";
import {
  conferirPullRequestRodada,
  concluirImplementacoesRodada,
  confirmarAprovacaoPullRequest,
  registrarRevisaoRodada,
} from "./transicoes_rodada.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const autora: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s1" };
const outra: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s2" };
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
  assert.equal(ag.demanda.estado, "entender_e_desenhar");
  assert.equal(ag.demanda.enviada, false);
  assert.equal(ag.demanda.criada_por.ferramenta, "claude");
  assert.equal(ag.demanda.criada_por.sessao, "s1");
  assert.deepEqual(ag.tickets[0]?.criado_por, FABRIQUINHA);
  assert.equal(ag.demanda.branch, "fabriquinha/I-1");
  assert.deepEqual(
    ag.tickets.map((t) => [t.ticket_id, t.etapa]),
    [[1, "entender_e_desenhar"]],
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

test("CA-3: envio completo congela e vai a gate_demanda; reenvio é reprovado", () => {
  const env = enviada();
  assert.equal(env.demanda.enviada, true);
  assert.equal(env.demanda.estado, "gate_demanda");
  assert.equal(env.demanda.estado_alterado_em, t1);
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
  assert.equal(ag.demanda.estado, "planejar");
  assert.deepEqual(ag.decisoes[0], {
    demanda_id: "I-1",
    ticket_id: 1,
    decisao_id: 1,
    gate: "gate_demanda",
    resultado: "aprovado",
    nota: 5,
    por: AUDITOR,
    em: t1,
  });
  assert.equal(ag.tickets[0]?.estado, "concluido");
  assert.deepEqual(ag.tickets[1], {
    demanda_id: "I-1",
    ticket_id: 2,
    etapa: "planejar",
    estado: "aberto",
    estado_alterado_em: t1,
    criado_por: FABRIQUINHA,
  });
  assert.equal(env.demanda.estado, "gate_demanda");
});

test("CA-5: recusa exige motivo, registra e cancela sem novo ticket", () => {
  const env = enviada();
  assert.throws(() => decidirDemanda(env, { aprovado: false }, AUDITOR, { agora: t1 }));
  const ag = decidirDemanda(env, { aprovado: false, motivo: "fora do escopo" }, AUDITOR, { agora: t1 });
  assert.equal(ag.demanda.estado, "cancelada");
  assert.equal(ag.decisoes[0]?.resultado, "reprovado");
  assert.equal(ag.decisoes[0].motivo, "fora do escopo");
  assert.equal(ag.tickets.length, 1);
  assert.equal(ag.tickets[0]?.estado, "cancelado");
});

test("decidir: só o Auditor, só em gate_demanda, e precisa do ticket da demanda", () => {
  assert.throws(() => decidirDemanda(enviada(), { aprovado: true }, EXTERNO, { agora: t1 }), ErroDeEscopo);
  assert.throws(() => decidirDemanda(registrada(), { aprovado: true }, AUDITOR, { agora: t1 }), ErroDeRegra);
  const env = enviada();
  const outro = {
    demanda_id: "I-1",
    ticket_id: 2,
    etapa: "planejar" as const,
    estado: "aberto" as const,
    estado_alterado_em: t0,
    criado_por: FABRIQUINHA,
  };
  const dois = decidirDemanda({ ...env, tickets: [...env.tickets, outro] }, { aprovado: true }, AUDITOR, { agora: t1 });
  assert.deepEqual(dois.tickets[1], outro);
  const sem = { ...enviada(), tickets: [] };
  assert.throws(() => decidirDemanda(sem, { aprovado: true }, AUDITOR, { agora: t1 }), ErroDeRegra);
});

test("CA-3: ferramenta exige Slug e o mesmo autor registra, edita, submete e envia com sessão preservada", () => {
  const autor: Ator = { tipo: "externo", ferramenta: "codex", sessao: " sessao-demo-197 " };
  assert.throws(() => registrarDemanda(reg, { ...autor, ferramenta: " codex " }, { agora: t0 }));
  let ag = registrarDemanda(reg, autor, { agora: t0 });
  assert.equal(ag.demanda.criada_por.ferramenta, "codex");
  assert.equal(ag.demanda.criada_por.sessao, " sessao-demo-197 ");
  ag = editarDemanda(ag, { titulo: "novo" }, autor);
  for (const tipo of ["criterios_aceite", "desenho_solucao", "custos_realizados"]) {
    ag = submeterEvidenciaDemanda(ag, ev(tipo), autor, t0);
  }
  assert.equal(enviarDemanda(ag, autor, { agora: t1 }).demanda.enviada, true);
  assert.throws(() => editarDemanda(ag, { titulo: "x" }, { ...autor, sessao: " outra " }), ErroDeEscopo);
});

const t2 = "2026-01-03T00:00:00Z";
const agente: Ator = { tipo: "agente", trabalho_id: "1" };
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
      configuracao_agente: { modelo: { provedor: "p", nome: "m" }, effort: "high" },
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
    tickets: aprovada.tickets.map((t) => (t.etapa === "planejar" ? { ...t, estado: "em_execucao" as const } : t)),
  };
};
const submetido = () => submeterPlano(emPlanejamento(), planoV(), agente, { agora: t2 });

test("CA-1: o agente submete o plano; vira evidência do ticket e a demanda vai a gate_planejamento", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const novo = submeterPlano(ag, planoV(), agente, { agora: t2 });
  assert.deepEqual(ag, antes);
  assert.equal(novo.demanda.estado, "gate_planejamento");
  assert.equal(novo.evidencias.filter((e) => e.tipo === "plano" && e.ticket_id === 2).length, 1);
  assert.deepEqual(novo.evidencias.find((e) => e.tipo === "plano")?.autor, agente);
  assert.deepEqual(novo.rodadas, []);
  assert.equal(novo.tickets.length, 2);
});

test("CA-2: ticket de implementação sem rodada é reprovado na submissão, sem mutação", () => {
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

test("CA-2: caminho absoluto Windows com barras normais é reprovado na submissão, sem mutação", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const plano = planoV();
  for (const caminho of ["C:/fora/segredo.ts", "c:/fora/segredo.ts"]) {
    const e = planoV({ tickets: [{ ...plano.tickets[0], caminhos: [caminho] }, ...plano.tickets.slice(1)] });
    assert.throws(() => submeterPlano(ag, e, agente, { agora: t2 }), /caminho relativo/);
  }
  assert.deepEqual(ag, antes);
});

test("CA-2 e CA-3: submissão reprovada sem mutação", () => {
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
  assert.throws(() => submeterPlano(ag, planoV({ criterios: ["CA-1"] }), FABRIQUINHA, { agora: t2 }), {
    name: "ErroDeEscopo",
    message: "só o agente do ticket de planejamento pode submeter o plano (peça à sessão de planejamento)",
  });
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
  assert.equal(novo.demanda.estado, "planejar");
  assert.deepEqual(novo.decisoes.at(-1), {
    demanda_id: "I-1",
    ticket_id: 2,
    decisao_id: 1,
    gate: "gate_planejamento",
    resultado: "reprovado",
    motivo: "falta teste",
    por: AUDITOR,
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

test("CA-6: sem a confirmação nada é criado; só o Auditor, no estado certo e com plano, confirma", () => {
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
        configuracao_agente: { modelo: { provedor: "p", nome: "m" }, effort: "high" },
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
  assert.equal(novo.demanda.estado, "em_execucao");
  assert.deepEqual(
    novo.rodadas.map((r) => [r.rodada_id, r.estado, r.e2e, r.branch]),
    [
      [1, "implementar", false, "fabriquinha/I-1-1"],
      [2, "implementar", true, "fabriquinha/I-1-2"],
    ],
  );
  assert.deepEqual(novo.dependencias_rodada, [{ demanda_id: "I-1", rodada_id: 2, depende_rodada_id: 1 }]);
  assert.deepEqual(novo.criterios_citados, [{ demanda_id: "I-1", rodada_id: 1, criterio_id: "CA-1" }]);
  // IDs do plano (4, 5, 6) são renumerados depois dos existentes (1, 2), na mesma ordem
  assert.deepEqual(
    novo.tickets.slice(2).map((t) => [t.ticket_id, t.titulo, t.rodada_id, t.etapa, t.estado, t.configuracao_agente]),
    [
      [3, "a", 2, "implementar", "aberto", { modelo: { provedor: "p", nome: "m" }, effort: "high" }],
      [4, "b", 2, "implementar", "aberto", undefined],
      [5, "c", 2, "implementar", "aberto", undefined],
      [6, "d", 1, "implementar", "aberto", undefined],
    ],
  );
  assert.deepEqual(novo.dependencias_ticket, [{ demanda_id: "I-1", ticket_id: 5, depende_ticket_id: 3 }]);
  assert.deepEqual(novo.caminhos_ticket, [{ demanda_id: "I-1", ticket_id: 4, caminho: "src/b.ts" }]);
  assert.equal(novo.tickets[1]?.estado, "concluido");
  assert.deepEqual(novo.decisoes.at(-1), {
    demanda_id: "I-1",
    ticket_id: 2,
    decisao_id: 1,
    gate: "gate_planejamento",
    resultado: "aprovado",
    nota: 4,
    por: AUDITOR,
    em: t2,
  });
  assert.equal(confirmarAprovacaoPlanejamento(ag, {}, AUDITOR, { agora: t2 }).decisoes.at(-1)?.nota, undefined);
});

const tk2 = (ag: AgregadoDemanda) => {
  const ticket = ag.tickets.find((ticket) => ticket.ticket_id === 2);
  assert.ok(ticket);
  return ticket;
};
const emExecucao = (status: string): AgregadoDemanda => {
  const ag = emPlanejamento();
  return {
    ...ag,
    demanda: { ...ag.demanda, estado: "em_execucao" },
    tickets: ag.tickets.map((t) => (t.ticket_id === 2 ? { ...t, estado: status as never } : t)),
  };
};

test("CA-16: a falha põe o ticket em falhou sem mudar estado nem decisões; recusa outro status e demanda encerrada", () => {
  const ag = emExecucao("em_execucao");
  const novo = registrarFalhaTicket(ag, { ticket_id: 2, falha: falhaQueExigeOAuditor("m") }, { agora: t2 });
  assert.equal(tk2(novo).estado, "falhou");
  assert.equal(tk2(novo).estado_alterado_em, t2);
  assert.equal(novo.demanda, ag.demanda);
  assert.equal(novo.decisoes, ag.decisoes);
  assert.throws(
    () => registrarFalhaTicket(novo, { ticket_id: 2, falha: falhaQueExigeOAuditor("m") }, { agora: t2 }),
    ErroDeRegra,
  );
  assert.throws(
    () => registrarFalhaTicket(ag, { ticket_id: 9, falha: falhaQueExigeOAuditor("m") }, { agora: t2 }),
    ErroDeRegra,
  );
  const fim = { ...ag, demanda: { ...ag.demanda, estado: "concluida" as const } };
  assert.throws(
    () => registrarFalhaTicket(fim, { ticket_id: 2, falha: falhaQueExigeOAuditor("m") }, { agora: t2 }),
    ErroDeRegra,
  );
});

test("CA-13 a CA-15: só o Auditor reabre, com instrução; volta a aberto com a instrução", () => {
  const ag = emExecucao("falhou");
  assert.throws(() => reabrirTicket(ag, { ticket_id: 2, instrucao: "  " }, AUDITOR, { agora: t2 }));
  assert.throws(() => reabrirTicket(ag, { ticket_id: 2, instrucao: "x" }, agente, { agora: t2 }), ErroDeEscopo);
  assert.throws(() => reabrirTicket(emExecucao("aberto"), { ticket_id: 2, instrucao: "x" }, AUDITOR, { agora: t2 }));
  const novo = reabrirTicket(ag, { ticket_id: 2, instrucao: "tente de novo" }, AUDITOR, { agora: t2 });
  assert.equal(tk2(novo).estado, "aberto");
  assert.equal(tk2(novo).instrucao, "tente de novo");
  assert.equal(novo.decisoes, ag.decisoes);
  assert.equal(tk2(ag).estado, "falhou");
});

test("retomada automática: só a Fabriquinha, só ticket falho e dentro da política; mantém instrução e histórico", () => {
  const retomar = (ag: AgregadoDemanda, entrada: object = {}, ator: Ator = FABRIQUINHA) =>
    retomarTicketFalhoPorInfraestrutura(ag, { ticket_id: 2, ...entrada }, ator, { agora: t2 });
  const base = emExecucao("em_execucao");
  const falha = { tipo: "falha_infraestrutura" as const, causa: "tempo_limite" as const, motivo: "HTTP 504" };
  const ag = registrarFalhaTicket(
    {
      ...base,
      tickets: base.tickets.map((ticket) =>
        ticket.ticket_id === 2
          ? { ...ticket, instrucao: "corrija", configuracao_agente: { effort: "high" as const } }
          : ticket,
      ),
    },
    { ticket_id: 2, falha },
    { agora: t2 },
  );
  assert.throws(() => retomar(ag, {}, AUDITOR), ErroDeEscopo);
  assert.throws(() => retomar(emExecucao("aberto")), ErroDeRegra);
  assert.throws(() => retomar({ ...ag, demanda: { ...ag.demanda, estado: "concluida" } }), ErroDeRegra);
  const novo = retomar(ag, { modelo: { provedor: "anthropic", nome: "claude-opus-5-5" } });
  assert.deepEqual(tk2(novo), {
    ...tk2(ag),
    estado: "aberto",
    estado_alterado_em: t2,
    configuracao_agente: { effort: "high", modelo: { provedor: "anthropic", nome: "claude-opus-5-5" } },
  });
  assert.deepEqual(novo.tentativas, ag.tentativas);
  assert.deepEqual(tk2(retomar(ag)).configuracao_agente, tk2(ag).configuracao_agente);
  const noLimite = {
    ...ag,
    tentativas: Array.from({ length: 4 }, (_, indice) => ({
      ticket: Endereco.doTicket("I-1", 2),
      numero: indice + 1,
      inicio: t0,
      fim: t2,
      resultado: falha,
    })),
  };
  assert.throws(() => retomar(noLimite), /já passou de 3 falhas seguidas/);
  assert.throws(() => retomar(emExecucao("falhou")), /não tem retomada automática/);
  assert.throws(() => retomar(falhar(base, 2)), /falha pede o Auditor/);
  const reinicio = {
    ...noLimite,
    tentativas: [
      ...noLimite.tentativas,
      {
        ticket: Endereco.doTicket("I-1", 2),
        numero: 5,
        inicio: t2,
        fim: t2,
        resultado: falhaPorServicoReiniciado,
      },
    ],
  };
  assert.equal(tk2(retomar(reinicio)).estado, "aberto");
  assert.deepEqual(retomar(reinicio).tentativas, reinicio.tentativas);
  const reaberto = reabrirTicket(noLimite, { ticket_id: 2, instrucao: "x" }, AUDITOR, { agora: t2 });
  assert.deepEqual(desdeAReabertura(tentativasDoTicket(reaberto.tentativas, 2)), []);
});

const falhar = (ag: AgregadoDemanda, ticket_id: number) =>
  registrarFalhaTicket(ag, { ticket_id, falha: falhaQueExigeOAuditor("m") }, { agora: t2 });
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
  assert.equal(aberto.demanda.estado, "gate_planejamento");
  const reaberto = reabrirTicket(antes, { ticket_id: 2, instrucao: "retome" }, AUDITOR, { agora: t2 });
  assert.equal(reaberto.demanda.estado, "planejar");
  assert.equal(submeterPlano(reaberto, planoV(), agente, { agora: t2 }).demanda.estado, "gate_planejamento");
});

test("T-965: ticket da demanda falho bloqueia envio e decisão até o Auditor reabrir", () => {
  const ag = falhar(completa(), 1);
  intacto(() => enviarDemanda(ag, autora, { agora: t1 }), ag);
  const reaberto = reabrirTicket(ag, { ticket_id: 1, instrucao: "retome" }, AUDITOR, { agora: t1 });
  const env = enviarDemanda(reaberto, autora, { agora: t1 });
  const emCurso = {
    ...env,
    tickets: env.tickets.map((t) => (t.ticket_id === 1 ? { ...t, estado: "em_execucao" as const } : t)),
  };
  const falhoNoGate = falhar(emCurso, 1);
  intacto(() => decidirDemanda(falhoNoGate, { aprovado: true }, AUDITOR, { agora: t2 }), falhoNoGate);
});

// Revisão integral (CA-12 a CA-14)
const D = "I-1";
const tkD = (ticket_id: number, etapa: string, status: string, rodada_id?: number) => ({
  demanda_id: D,
  ticket_id,
  rodada_id,
  etapa,
  estado: status,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const rodadaD = (rodada_id: number, estado: string) => ({
  demanda_id: D,
  rodada_id,
  titulo: "r",
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/${D}-${String(rodada_id)}`,
});
const montarD = (estado = "em_execucao", estados = ["concluida"], extra: object[] = []): AgregadoDemanda =>
  AgregadoDemanda.parse({
    demanda: { ...registrada().demanda, enviada: true, estado },
    decisoes: [],
    evidencias: [{ demanda_id: D, tipo: "criterios_aceite", dados: criterios, autor: autora, em: t0 }],
    tickets: [tkD(1, "entender_e_desenhar", "concluido"), tkD(2, "implementar", "concluido", 1), ...extra],
    rodadas: estados.map((f, i) => rodadaD(i + 1, f)),
  });
const emRevisaoD = () => montarD("revisar_demanda", ["concluida"], [tkD(3, "revisar_demanda", "em_execucao")]);
const corretivo = (m: Record<string, unknown> = {}) => ({
  demanda_id: D,
  criterios: ["CA-2"],
  rodadas: [{ demanda_id: D, rodada_id: 1, titulo: "corrige", e2e: false, criterios: ["CA-2"] }],
  tickets: [{ demanda_id: D, ticket_id: 1, titulo: "c", descricao: "d", rodada_id: 1 }],
  ...m,
});
const revisao = (m: Record<string, unknown> = {}) => ({
  demanda_id: D,
  ticket_id: 3,
  aprovado: false,
  exigencias: "falta tratar erro",
  plano: corretivo(),
  ...m,
});
const aprovacaoD = (ticket_id = 3) => ({ demanda_id: D, ticket_id, aprovado: true });
const ag3: Ator = { tipo: "agente", trabalho_id: "1" };
const c2 = { agora: t2 };
const recusar = (ag: AgregadoDemanda, fn: () => unknown, erro: new (...a: never[]) => Error = ErroDeRegra) => {
  const antes = structuredClone(ag);
  assert.throws(fn, erro);
  assert.deepEqual(ag, antes);
};

test("CA-12: todas as rodadas concluídas abrem revisar_demanda e vão a revisar_demanda", () => {
  const ag = montarD();
  const antes = structuredClone(ag);
  const novo = iniciarRevisaoDemanda(ag, { demanda_id: D }, FABRIQUINHA, c2);
  assert.deepEqual(ag, antes);
  assert.equal(novo.demanda.estado, "revisar_demanda");
  assert.equal(novo.demanda.estado_alterado_em, t2);
  assert.deepEqual(novo.tickets.slice(0, 2), ag.tickets);
  assert.deepEqual(novo.tickets[2], {
    demanda_id: D,
    ticket_id: 3,
    etapa: "revisar_demanda",
    estado: "aberto",
    estado_alterado_em: t2,
    criado_por: FABRIQUINHA,
  });
});

test("CA-12: recusa por estado de rodada, pendência, ator, estado e entrada, sem mutação", () => {
  const abrir = (ag: AgregadoDemanda, ator: Ator = FABRIQUINHA, e: unknown = { demanda_id: D }) => {
    recusar(ag, () => iniciarRevisaoDemanda(ag, e, ator, c2), ator === FABRIQUINHA ? Error : ErroDeEscopo);
  };
  for (const estado of ["implementar", "revisar_rodada", "encerrar_rodada", "gate_pr", "ajustar_resultado"]) {
    abrir(montarD("em_execucao", ["concluida", estado]));
  }
  for (const status of ["aberto", "em_execucao", "falhou"]) {
    abrir(montarD("em_execucao", ["concluida"], [tkD(3, "revisar_rodada", status, 1)]));
  }
  abrir(montarD("em_execucao", ["concluida"], [tkD(3, "implementar", "cancelado", 1)]));
  abrir(montarD("revisar_demanda"));
  abrir(montarD(), AUDITOR);
  abrir(montarD(), agente);
  abrir(montarD(), FABRIQUINHA, { demanda_id: "I-2" });
  abrir(montarD(), FABRIQUINHA, { demanda_id: D, extra: 1 });
  abrir(montarD(), FABRIQUINHA, {});
});

test("CA-13: reprovação cria só rodadas novas, preserva as integradas e o plano, e volta a execucao", () => {
  const ag = emRevisaoD();
  const antes = structuredClone(ag);
  const novo = registrarRevisaoDemanda(ag, revisao(), ag3, c2);
  assert.deepEqual(ag, antes);
  assert.equal(novo.demanda.estado, "em_execucao");
  assert.deepEqual(novo.rodadas.slice(0, 1), ag.rodadas);
  assert.deepEqual(
    novo.rodadas.map((r) => [r.rodada_id, r.estado]),
    [
      [1, "concluida"],
      [2, "implementar"],
    ],
  );
  assert.deepEqual(
    novo.tickets.map((t) => [t.ticket_id, t.etapa, t.estado, t.rodada_id]),
    [
      [1, "entender_e_desenhar", "concluido", undefined],
      [2, "implementar", "concluido", 1],
      [3, "revisar_demanda", "concluido", undefined],
      [4, "implementar", "aberto", 2],
    ],
  );
  assert.deepEqual(novo.decisoes, [
    {
      demanda_id: D,
      ticket_id: 3,
      decisao_id: 1,
      gate: "gate_revisao_demanda",
      resultado: "reprovado",
      motivo: "falta tratar erro",
      por: ag3,
      em: t2,
    },
  ]);
  assert.deepEqual(novo.evidencias, ag.evidencias);
  assert.deepEqual(tentativasDoTicket(novo.tentativas, 3).at(-1)?.resultado, { tipo: "sucesso" });
});

test("CA-13: reprovação reprovada sem mutação (exigências, plano, ticket, ator, estado e pendência)", () => {
  const ag = emRevisaoD();
  const tenta = (m: Record<string, unknown>, ator: Ator = ag3, erro: new (...a: never[]) => Error = Error) => {
    recusar(ag, () => registrarRevisaoDemanda(ag, revisao(m), ator, c2), erro);
  };
  tenta({ exigencias: "" });
  tenta({ exigencias: undefined });
  tenta({ plano: undefined });
  tenta({ plano: corretivo({ rodadas: [], tickets: [] }) });
  tenta({ plano: corretivo({ tickets: [] }) });
  tenta({ plano: corretivo({ criterios: ["CA-9"] }) });
  tenta({ plano: corretivo({ demanda_id: "I-2" }) });
  tenta({ extra: 1 });
  tenta({ demanda_id: "I-2" });
  tenta({ ticket_id: 2 });
  tenta({ ticket_id: 9 });
  const antesDaRecusa = structuredClone(ag);
  assert.throws(() => registrarRevisaoDemanda(ag, revisao(), EXTERNO, c2), {
    name: "ErroDeEscopo",
    message: "só o agente do ticket revisar_demanda atual decide a revisão (peça à sessão de revisão)",
  });
  assert.deepEqual(ag, antesDaRecusa);
  tenta({}, AUDITOR, ErroDeEscopo);
  tenta({}, FABRIQUINHA, ErroDeEscopo);
  const exec = montarD("em_execucao", ["concluida"], [tkD(3, "revisar_demanda", "em_execucao")]);
  recusar(exec, () => registrarRevisaoDemanda(exec, revisao(), ag3, c2));
  const feito = montarD("revisar_demanda", ["concluida"], [tkD(3, "revisar_demanda", "concluido")]);
  recusar(feito, () => registrarRevisaoDemanda(feito, revisao(), ag3, c2));
  const pendencias = [
    montarD("revisar_demanda", ["concluida", "revisar_rodada"], [tkD(3, "revisar_demanda", "em_execucao")]),
    montarD(
      "revisar_demanda",
      ["concluida"],
      [tkD(3, "revisar_demanda", "em_execucao"), tkD(4, "implementar", "aberto", 1)],
    ),
    montarD(
      "revisar_demanda",
      ["concluida"],
      [tkD(3, "revisar_demanda", "em_execucao"), tkD(4, "encerrar_rodada", "falhou", 1)],
    ),
  ];
  for (const p of pendencias) {
    recusar(p, () => registrarRevisaoDemanda(p, revisao(), ag3, c2));
  }
});

test("CA-14: aprovação conclui a revisão, abre encerrar_demanda e vai a encerramento sem outro efeito", () => {
  const ag = emRevisaoD();
  const novo = registrarRevisaoDemanda(ag, aprovacaoD(), ag3, c2);
  assert.equal(novo.demanda.estado, "encerrar_demanda");
  assert.deepEqual(tentativasDoTicket(novo.tentativas, 3).at(-1)?.resultado, { tipo: "sucesso" });
  assert.deepEqual(novo.rodadas, ag.rodadas);
  assert.deepEqual(
    novo.tickets.map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [1, "entender_e_desenhar", "concluido"],
      [2, "implementar", "concluido"],
      [3, "revisar_demanda", "concluido"],
      [4, "encerrar_demanda", "aberto"],
    ],
  );
  assert.deepEqual(novo.decisoes, [
    {
      demanda_id: D,
      ticket_id: 3,
      decisao_id: 1,
      gate: "gate_revisao_demanda",
      resultado: "aprovado",
      por: ag3,
      em: t2,
    },
  ]);
  recusar(ag, () => registrarRevisaoDemanda(ag, { ...aprovacaoD(), exigencias: "x" }, ag3, c2), Error);
});

test("CA-13: percurso completo das rodadas corretivas e só então a revisão integral se repete", () => {
  const original = emRevisaoD();
  const rep = registrarRevisaoDemanda(original, revisao(), ag3, c2);
  // a demanda em execucao com rodada corretiva aberta não aceita nova revisão integral
  recusar(rep, () => iniciarRevisaoDemanda(rep, { demanda_id: D }, FABRIQUINHA, c2));
  // implementação concluída por fixture da aplicação
  const impl = {
    ...rep,
    tickets: rep.tickets.map((t) => (t.ticket_id === 4 ? { ...t, estado: "concluido" as const } : t)),
  };
  const r = { demanda_id: D, rodada_id: 2 };
  const emRevisao = concluirImplementacoesRodada(impl, r, FABRIQUINHA, c2);
  recusar(emRevisao, () => iniciarRevisaoDemanda(emRevisao, { demanda_id: D }, FABRIQUINHA, c2));
  const ag5: Ator = { tipo: "agente", trabalho_id: "2" };
  const encerrando = registrarRevisaoRodada(emRevisao, { ...r, ticket_id: 5, aprovado: true }, ag5, c2);
  const conferida = conferirPullRequestRodada(
    encerrando,
    { ...r, ticket_id: 6, documentacao_entregue: true, conflito: false, check_falho: false },
    FABRIQUINHA,
    c2,
  );
  const integrada = confirmarAprovacaoPullRequest(conferida, { ...r, ticket_id: 6, nota: 4 }, AUDITOR, {
    agora: t2,
    integracao: { ...r, ticket_id: 6, confirmada: true, branch_destino: "fabriquinha/I-1" },
  });
  assert.deepEqual(
    integrada.rodadas.map((x) => x.estado),
    ["concluida", "concluida"],
  );
  const segunda = iniciarRevisaoDemanda(integrada, { demanda_id: D }, FABRIQUINHA, c2);
  assert.equal(segunda.demanda.estado, "revisar_demanda");
  const ag7: Ator = { tipo: "agente", trabalho_id: "3" };
  const fim = registrarRevisaoDemanda(segunda, aprovacaoD(7), ag7, c2);
  assert.equal(fim.demanda.estado, "encerrar_demanda");
  assert.equal(fim.tickets.at(-1)?.etapa, "encerrar_demanda");
  assert.deepEqual(
    fim.decisoes.map((d) => [d.ticket_id, d.decisao_id, d.resultado]),
    [
      [3, 1, "reprovado"],
      [5, 1, "aprovado"],
      [6, 1, "aprovado"],
      [7, 1, "aprovado"],
    ],
  );
});

// Demanda em execução com os tickets 3 e 4 (implementar, rodada 1) abertos, mais o global 99 da etapa dada.
const emDevolucao = (
  etapa: "implementar" | "resolver_conflito" | "revisar_demanda",
  status: string,
  reprovacoes = 0,
) => {
  const base = confirmarAprovacaoPlanejamento(submetido(), {}, AUDITOR, { agora: t2 });
  const global = etapa !== "implementar";
  return {
    ...base,
    tentativas: [
      ...base.tentativas,
      ...Array.from({ length: reprovacoes }, (_, indice) => ({
        ticket: Endereco.doTicket("I-1", 3),
        numero: indice + 1,
        inicio: t0,
        fim: t1,
        resultado: { tipo: "reprovacao" as const, motivo: "corrija antes" },
      })),
    ],
    tickets: base.tickets.map((t) =>
      t.ticket_id === 3 ? { ...t, etapa, estado: status as never, ...(global && { rodada_id: undefined }) } : t,
    ),
  };
};
const tk3 = (ag: AgregadoDemanda) => {
  const ticket = ag.tickets.find((ticket) => ticket.ticket_id === 3);
  assert.ok(ticket);
  return ticket;
};
const id = () => 3;
const devolver = (ag: AgregadoDemanda, ator: Ator = FABRIQUINHA) =>
  devolverTicket(ag, { ticket_id: id(), instrucao: "corrija os testes" }, ator, { agora: t2 });

test("CA-1, CA-2: primeira e segunda reprovações voltam a aberto com instrução e Tentativa encerrada", () => {
  assert.equal(POLITICA_DE_TENTATIVAS.limites.reprovacoes, 2);
  for (const etapa of ["implementar", "resolver_conflito"] as const) {
    for (const anteriores of [0, 1]) {
      const novo = devolver(emDevolucao(etapa, "em_execucao", anteriores));
      assert.deepEqual([tk3(novo).estado, tk3(novo).instrucao], ["aberto", "corrija os testes"]);
      assert.equal(tentativasDoTicket(novo.tentativas, 3).length, anteriores + 1);
      assert.deepEqual(novo.tentativas.at(-1), {
        ticket: Endereco.doTicket("I-1", 3),
        numero: anteriores + 1,
        inicio: t2,
        fim: t2,
        resultado: { tipo: "reprovacao", motivo: "corrija os testes" },
      });
    }
  }
});

test("CA-3, CA-13: na 3ª reprovação falha com o motivo e bloqueia a seleção até a reabertura", () => {
  const ag = devolver(emDevolucao("implementar", "em_execucao", 2));
  assert.deepEqual([tk3(ag).estado, motivoDaFalhaDoTicket(ag.tentativas, tk3(ag))], ["falhou", "corrija os testes"]);
  assert.deepEqual(selecionarTrabalho(ag, true), []);
  const global = devolver(emDevolucao("resolver_conflito", "em_execucao", 2));
  assert.deepEqual(
    [tk3(global).estado, motivoDaFalhaDoTicket(global.tentativas, tk3(global))],
    ["falhou", "corrija os testes"],
  );
  assert.deepEqual(selecionarTrabalho(global, true), []);
});

test("CA-4, CA-7: falha de infraestrutura grava causa e motivo sem reprovação; sem motivo é reprovada", () => {
  const ag = emDevolucao("implementar", "em_execucao");
  const falha = { tipo: "falha_infraestrutura", causa: "tempo_limite", motivo: "timeout" };
  const novo = registrarFalhaTicket(ag, { ticket_id: id(), falha }, { agora: t2 });
  assert.equal(tk3(novo).estado, "falhou");
  assert.deepEqual(novo.tentativas.at(-1)?.resultado, falha);
  assert.equal(
    tentativasDoTicket(novo.tentativas, 3).filter((tentativa) => tentativa.resultado?.tipo === "reprovacao").length,
    0,
  );
  for (const entrada of [{ ticket_id: id() }, { ticket_id: id(), falha: { ...falha, motivo: " " } }]) {
    assert.throws(() => registrarFalhaTicket(ag, entrada, { agora: t2 }));
  }
  assert.equal(tk3(ag).estado, "em_execucao");
});

test("CA-5, CA-6, CA-12: devolução reprovada em etapa, status ou ator errados", () => {
  intacto(() => devolver(emDevolucao("revisar_demanda", "em_execucao")), emDevolucao("revisar_demanda", "em_execucao"));
  const aberto = emDevolucao("implementar", "aberto");
  intacto(() => devolver(aberto), aberto);
  const ag = emDevolucao("implementar", "em_execucao");
  for (const ator of [AUDITOR, { tipo: "agente", trabalho_id: "1" } as Ator]) {
    assert.throws(() => devolver(ag, ator), ErroDeEscopo);
  }
  assert.equal(tk3(ag).estado, "em_execucao");
  assert.deepEqual(tentativasDoTicket(ag.tentativas, 3), []);
  const fim = { ...ag, demanda: { ...ag.demanda, estado: "concluida" as const } };
  intacto(() => devolver(fim), fim);
});

test("CA-8, CA-9: reabrir grava marco e reinicia política sem apagar histórico, decisões ou evidências", () => {
  const falho = devolver(emDevolucao("implementar", "em_execucao", 2));
  const novo = reabrirTicket(falho, { ticket_id: id(), instrucao: "tente" }, AUDITOR, { agora: t2 });
  assert.deepEqual(
    [tk3(novo).estado, tk3(novo).instrucao, motivoDaFalhaDoTicket(novo.tentativas, tk3(novo))],
    ["aberto", "tente", undefined],
  );
  assert.deepEqual(novo.tentativas.slice(0, -1), falho.tentativas);
  assert.deepEqual(novo.tentativas.at(-1), {
    ticket: Endereco.doTicket("I-1", 3),
    numero: 4,
    inicio: t2,
    fim: t2,
    instrucao: "tente",
    resultado: { tipo: "interrompida", por: AUDITOR },
  });
  assert.deepEqual(desdeAReabertura(tentativasDoTicket(novo.tentativas, 3)), []);
  assert.equal(novo.decisoes, falho.decisoes);
  assert.equal(novo.evidencias, falho.evidencias);
  const executandoDeNovo = mudarTicket(novo, tk3(novo), "em_execucao", t2);
  const devolvidoDeNovo = devolver(executandoDeNovo);
  assert.equal(tk3(devolvidoDeNovo).estado, "aberto");
  assert.equal(tentativasDoTicket(devolvidoDeNovo.tentativas, 3).length, 5);
});

test("mudarTicket encerra a Tentativa aberta ou sintetiza o início; preserva as dos outros tickets", () => {
  const base = emExecucao("em_execucao");
  const alvo = tk2(base);
  const outroTicket = base.tickets[0];
  assert.ok(outroTicket);
  const deOutroTicket = comTentativaAberta(base.tentativas, outroTicket, "exec-outro", t0);
  for (const aberta of [false, true]) {
    const ag = {
      ...base,
      tentativas: aberta ? comTentativaAberta(deOutroTicket, alvo, "exec-alvo", t1) : deOutroTicket,
    };
    const antes = structuredClone(ag);
    const concluido = mudarTicket(ag, alvo, "concluido", t2);
    assert.deepEqual(ag, antes);
    assert.deepEqual(tentativasDoTicket(concluido.tentativas, 1), tentativasDoTicket(ag.tentativas, 1));
    assert.deepEqual(tentativasDoTicket(concluido.tentativas, 2), [
      {
        ticket: Endereco.doTicket("I-1", 2),
        numero: 1,
        inicio: aberta ? t1 : alvo.estado_alterado_em,
        fim: t2,
        ...(aberta && { processo_id: "exec-alvo" }),
        resultado: { tipo: "sucesso" },
      },
    ]);
    assert.equal(tk2(concluido).estado, "concluido");
  }
});

test("mudarTicket conclui ticket aberto com Tentativa aberta e não inventa resultado ao reservar", () => {
  const base = emExecucao("aberto");
  const alvo = tk2(base);
  const ag = { ...base, tentativas: comTentativaAberta(base.tentativas, alvo, "exec-ajustes", t1) };
  const concluido = mudarTicket(ag, alvo, "concluido", t2);
  assert.deepEqual(concluido.tentativas.at(-1), {
    ticket: Endereco.doTicket("I-1", 2),
    numero: 1,
    inicio: t1,
    fim: t2,
    processo_id: "exec-ajustes",
    resultado: { tipo: "sucesso" },
  });
  assert.equal(ag.tentativas.at(-1)?.fim, undefined);
  assert.equal(mudarTicket(ag, alvo, "em_execucao", t2).tentativas, ag.tentativas);
});

test("decisão e aprovação do planejamento registram sucesso; reprovar fecha a Tentativa do planejar", () => {
  const aprovada = decidirDemanda(enviada(), { aprovado: true }, AUDITOR, { agora: t1 });
  assert.deepEqual(aprovada.tentativas.at(-1)?.resultado, { tipo: "sucesso" });
  const reprovada = decidirDemanda(enviada(), { aprovado: false, motivo: "fora" }, AUDITOR, { agora: t1 });
  assert.deepEqual(reprovada.tentativas.at(-1)?.resultado, { tipo: "interrompida", por: AUDITOR });
  const base = submetido();
  const ag = { ...base, tentativas: comTentativaAberta(base.tentativas, tk2(base), "exec-planejar", t1) };
  const reprovado = reprovarPlanejamento(ag, { motivo: "falta teste" }, AUDITOR, { agora: t2 });
  assert.deepEqual(reprovado.tentativas.at(-1), {
    ticket: Endereco.doTicket("I-1", 2),
    numero: 1,
    processo_id: "exec-planejar",
    inicio: t1,
    fim: t2,
    resultado: { tipo: "interrompida", por: AUDITOR, motivo: "falta teste" },
  });
  const planejado = confirmarAprovacaoPlanejamento(ag, {}, AUDITOR, { agora: t2 });
  assert.deepEqual(planejado.tentativas.at(-1)?.resultado, { tipo: "sucesso" });
  assert.equal(planejado.tentativas.at(-1)?.processo_id, "exec-planejar");
  assert.equal(ag.tentativas.at(-1)?.fim, undefined);
});

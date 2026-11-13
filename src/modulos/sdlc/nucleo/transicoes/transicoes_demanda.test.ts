import assert from "node:assert/strict";
import { test } from "node:test";
import { comEvidencia, comPlanoSubmetido } from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { clonarAgregadoDemanda as structuredClone } from "../../../../../apoio-testes/clonar_agregado_demanda.ts";
import { type Ator, AUDITOR, FABRIQUINHA } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { AgregadoDemanda } from "../demanda/agregado_demanda.ts";
import { GATE_DA_DEMANDA, GATES } from "../../../ciclo_de_vida/conducao/publico.ts";
import { Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import {
  comTentativaAberta,
  desdeAReabertura,
  motivoDaFalhaDoTicket,
  POLITICA_DE_TENTATIVAS,
  tentativasDoTicket,
} from "../tentativa.ts";
import {
  falhaQueExigeOAuditor,
  falhaPorServicoReiniciado,
} from "../../../compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { Despacho, situacaoDeUmaDemanda } from "../../../ciclo_de_vida/despacho/nucleo/despacho.ts";
import {
  enviarDemanda,
  devolverTicket,
  iniciarRevisaoDemanda,
  mudarTicket,
  reabrirTicket,
  retomarTicketFalhoPorInfraestrutura,
  registrarDemanda,
  registrarFalhaTicket,
  validarPlano,
} from "./transicoes_demanda.ts";
import { conferirPullRequestRodada, concluirImplementacoesRodada } from "./transicoes_rodada.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const autora: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s1" };
const outra: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s2" };
const reg = { id: "I-1", projeto: "p", titulo: "t", tipo: "funcionalidade", descricao: "d" };
const ev = (tipo: string, extra = {}) => ({ tipo: tipo as never, dados: { v: 1 }, ...extra });

const registrada = () => registrarDemanda(reg, autora, { agora: t0 });
const completa = (): AgregadoDemanda =>
  ["criterios_aceite", "desenho_solucao"].reduce((ag, tipo) => comEvidencia(ag, ev(tipo), autora, t0), registrada());
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

test("CA-6: outra sessão não envia", () => {
  assert.throws(() => enviarDemanda(completa(), outra, { agora: t1 }), ErroDeEscopo);
});

test("CA-2: envio incompleto lista todas as pendências e não muda nada", () => {
  const ag = comEvidencia(registrada(), ev("desenho_solucao"), autora, t0);
  const antes = structuredClone(ag);
  assert.throws(
    () => enviarDemanda(ag, autora, { agora: t1 }),
    (e: Error) => e instanceof ErroDeRegra && e.message.includes("criterios_aceite"),
  );
  assert.deepEqual(ag, antes);
});

test("CA-3: envio completo congela e vai a gate_demanda; reenvio é reprovado", () => {
  const env = enviada();
  assert.equal(env.demanda.enviada, true);
  assert.equal(env.demanda.estado, "gate_demanda");
  assert.equal(env.demanda.estado_alterado_em, t1);
  assert.throws(() => enviarDemanda(env, autora, { agora: t1 }), ErroDeRegra);
});

test("CA-3: ferramenta exige Slug e o mesmo autor registra, submete e envia com sessão preservada", () => {
  const autor: Ator = { tipo: "externo", ferramenta: "codex", sessao: " sessao-demo-197 " };
  assert.throws(() => registrarDemanda(reg, { ...autor, ferramenta: " codex " }, { agora: t0 }));
  let ag = registrarDemanda(reg, autor, { agora: t0 });
  assert.equal(ag.demanda.criada_por.ferramenta, "codex");
  assert.equal(ag.demanda.criada_por.sessao, " sessao-demo-197 ");
  for (const tipo of ["criterios_aceite", "desenho_solucao"]) {
    ag = comEvidencia(ag, ev(tipo), autor, t0);
  }
  assert.throws(() => enviarDemanda(ag, { ...autor, sessao: " outra " }, { agora: t1 }), ErroDeEscopo);
  assert.equal(enviarDemanda(ag, autor, { agora: t1 }).demanda.enviada, true);
});

const t2 = "2026-01-03T00:00:00Z";
const agente: Ator = { tipo: "agente", trabalho_id: "1" };
const criterios = { criterios: [{ id: "CA-1" }, { id: "CA-2" }] };
const planoV = (m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  criterios: ["CA-1"],
  arquivos_previstos: ["src/b.ts"],
  rodadas: [
    {
      demanda_id: "I-1",
      rodada_id: 1,
      titulo: "r1",
      e2e: false,
      criterios: ["CA-1"],
      arquivos_previstos: ["src/b.ts"],
    },
    { demanda_id: "I-1", rodada_id: 2, titulo: "r2", e2e: true, depende: [{ demanda_id: "I-1", rodada_id: 1 }] },
  ],
  tickets: [
    { demanda_id: "I-1", ticket_id: 2, titulo: "b", descricao: "d", rodada_id: 1, arquivos_previstos: ["src/b.ts"] },
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
  const definida = ["criterios_aceite", "desenho_solucao"].reduce(
    (ag, tipo) => comEvidencia(ag, ev(tipo, tipo === "criterios_aceite" ? { dados: criterios } : {}), autora, t0),
    registrada(),
  );
  const decisaoAprovando = GATE_DA_DEMANDA.decidir(
    enviarDemanda(definida, autora, { agora: t1 }),
    Endereco.daDemanda("I-1"),
    { resultado: "aprovado" },
    AUDITOR,
    { agora: t1 },
  );
  return {
    ...decisaoAprovando,
    tickets: decisaoAprovando.tickets.map((t) =>
      t.etapa === "planejar" ? { ...t, estado: "em_execucao" as const } : t,
    ),
  };
};
const submetido = () => comPlanoSubmetido(emPlanejamento(), planoV(), agente, t2);
const aprovarPlanejamento = (ag: AgregadoDemanda) =>
  GATES.gate_planejamento.regra.decidir(ag, Endereco.daDemanda("I-1"), { resultado: "aprovado" }, AUDITOR, {
    agora: t2,
  });

test("CA-2: ticket de implementação sem rodada é reprovado na submissão, sem mutação", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const plano = planoV();
  const { rodada_id: _, ...semRodada } = plano.tickets[2] as Record<string, unknown>;
  const e = planoV({
    tickets: [plano.tickets[0], plano.tickets[1], semRodada, { ...semRodada, ticket_id: 9, rodada_id: 2 }],
  });
  assert.throws(() => validarPlano(ag, e, agente), /não têm rodada/);
  const vazia = planoV({ tickets: [plano.tickets[0], plano.tickets[1]] });
  assert.throws(() => validarPlano(ag, vazia, agente), /rodada 2 não tem ticket/);
  assert.deepEqual(ag, antes);
});

test("CA-2: caminho absoluto Windows com barras normais é reprovado na submissão, sem mutação", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const plano = planoV();
  for (const caminho of ["C:/fora/segredo.ts", "c:/fora/segredo.ts"]) {
    const e = planoV({ tickets: [{ ...plano.tickets[0], arquivos_previstos: [caminho] }, ...plano.tickets.slice(1)] });
    assert.throws(() => validarPlano(ag, e, agente), /caminho relativo/);
  }
  assert.deepEqual(ag, antes);
});

test("CA-2 e CA-3: submissão reprovada sem mutação", () => {
  const ag = emPlanejamento();
  const antes = structuredClone(ag);
  const falha = (e: unknown, ator: Ator = agente, base = ag) => {
    assert.throws(() => validarPlano(base, e, ator));
  };
  falha(
    planoV({ rodadas: [], tickets: [{ demanda_id: "I-1", ticket_id: 1, titulo: "a", descricao: "d", rodada_id: 5 }] }),
  );
  falha(planoV({ demanda_id: "I-2", rodadas: [], tickets: [] }));
  falha(planoV({ criterios: ["CA-9"] }));
  falha(planoV({ criterios: ["CA-1"] }), { tipo: "auditor" });
  assert.throws(() => validarPlano(ag, planoV({ criterios: ["CA-1"] }), FABRIQUINHA), {
    name: "ErroDeEscopo",
    message: "só o agente do ticket de planejamento pode submeter o plano (peça à sessão de planejamento)",
  });
  falha(planoV(), agente, enviada());
  falha(planoV(), agente, submetido());
  falha(planoV(), agente, { ...ag, tickets: [ag.tickets[0] as never] });
  assert.deepEqual(ag, antes);
  const semDefinicao = { ...ag, evidencias: [] };
  assert.throws(() => validarPlano(semDefinicao, planoV(), agente), /CA-1/);
  const malFormada = { ...ag, evidencias: ag.evidencias.map((e) => ({ ...e, dados: { x: 1 } })) };
  assert.throws(() => validarPlano(malFormada, planoV(), agente), /CA-1/);
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

test("CA-16: a falha põe o ticket em falhou sem mudar estado nem decisões; rejeita outro status e demanda encerrada", () => {
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

test("T-965: ticket de planejamento falho bloqueia a submissão até o Auditor reabrir", () => {
  const antes = falhar(emPlanejamento(), 2);
  intacto(() => validarPlano(antes, planoV(), agente), antes);
  const reaberto = reabrirTicket(antes, { ticket_id: 2, instrucao: "retome" }, AUDITOR, { agora: t2 });
  assert.equal(reaberto.demanda.estado, "planejar");
  assert.doesNotThrow(() => validarPlano(reaberto, planoV(), agente));
});

test("T-965: ticket da demanda falho bloqueia o envio até o Auditor reabrir", () => {
  const ag = falhar(completa(), 1);
  intacto(() => enviarDemanda(ag, autora, { agora: t1 }), ag);
  const reaberto = reabrirTicket(ag, { ticket_id: 1, instrucao: "retome" }, AUDITOR, { agora: t1 });
  assert.equal(enviarDemanda(reaberto, autora, { agora: t1 }).demanda.estado, "gate_demanda");
});

// Revisão integral (CA-12)
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
const ag3: Ator = { tipo: "agente", trabalho_id: "1" };
const c2 = { agora: t2 };
const rejeitarSemMudar = (ag: AgregadoDemanda, fn: () => unknown, erro: new (...a: never[]) => Error = ErroDeRegra) => {
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

test("CA-12: rejeita por estado de rodada, pendência, ator, estado e entrada, sem mutação", () => {
  const abrir = (ag: AgregadoDemanda, ator: Ator = FABRIQUINHA, e: unknown = { demanda_id: D }) => {
    rejeitarSemMudar(ag, () => iniciarRevisaoDemanda(ag, e, ator, c2), ator === FABRIQUINHA ? Error : ErroDeEscopo);
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

test("CA-13: percurso completo das rodadas corretivas e só então a revisão integral se repete", () => {
  const demandaId = Endereco.daDemanda(D);
  const original = emRevisaoD();
  const rep = GATES.gate_revisao_demanda.regra.decidir(
    original,
    demandaId,
    { resultado: "reprovado", motivo: "falta tratar erro", correcoes: corretivo() },
    ag3,
    c2,
  );
  // a demanda em execucao com rodada corretiva aberta não aceita nova revisão integral
  rejeitarSemMudar(rep, () => iniciarRevisaoDemanda(rep, { demanda_id: D }, FABRIQUINHA, c2));
  // implementação concluída por fixture da aplicação
  const impl = {
    ...rep,
    tickets: rep.tickets.map((t) => (t.ticket_id === 4 ? { ...t, estado: "concluido" as const } : t)),
  };
  const r = { demanda_id: D, rodada_id: 2 };
  const emRevisao = concluirImplementacoesRodada(impl, r, FABRIQUINHA, c2);
  rejeitarSemMudar(emRevisao, () => iniciarRevisaoDemanda(emRevisao, { demanda_id: D }, FABRIQUINHA, c2));
  const ag5: Ator = { tipo: "agente", trabalho_id: "2" };
  const encerrando = GATES.gate_revisao_rodada.regra.decidir(
    emRevisao,
    Endereco.daRodada(D, 2),
    { resultado: "aprovado" },
    ag5,
    c2,
  );
  const conferida = conferirPullRequestRodada(
    encerrando,
    { ...r, ticket_id: 6, documentacao_entregue: true, conflito: false, check_falho: false },
    FABRIQUINHA,
    c2,
  );
  const integrada = GATES.gate_pr.regra.decidir(
    conferida,
    Endereco.daRodada(D, 2),
    { resultado: "aprovado", nota: 4 },
    AUDITOR,
    c2,
  );
  assert.deepEqual(
    integrada.rodadas.map((x) => x.estado),
    ["concluida", "concluida"],
  );
  const segunda = iniciarRevisaoDemanda(integrada, { demanda_id: D }, FABRIQUINHA, c2);
  assert.equal(segunda.demanda.estado, "revisar_demanda");
  const ag7: Ator = { tipo: "agente", trabalho_id: "3" };
  const fim = GATES.gate_revisao_demanda.regra.decidir(segunda, demandaId, { resultado: "aprovado" }, ag7, c2);
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
  const base = aprovarPlanejamento(submetido());
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
  assert.deepEqual(new Despacho().selecionar(situacaoDeUmaDemanda(ag, true)).prontos, []);
  const global = devolver(emDevolucao("resolver_conflito", "em_execucao", 2));
  assert.deepEqual(
    [tk3(global).estado, motivoDaFalhaDoTicket(global.tentativas, tk3(global))],
    ["falhou", "corrija os testes"],
  );
  assert.deepEqual(new Despacho().selecionar(situacaoDeUmaDemanda(global, true)).prontos, []);
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

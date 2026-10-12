import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import type { Agregado, Ator, Contexto, Evidencia, Issue, Ticket } from "./agregado.ts";
import { concluirTicket } from "./conclusao.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import type { Etapa } from "./primitivos.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const ANTES = "2026-10-11T11:00:00.000Z";
const fabriquinha: Ator = { tipo: "fabriquinha" };

/** `comCommit`: os tickets que têm commit registrado. */
const contexto = (comCommit: readonly number[] = []): Contexto => ({
  agora: AGORA,
  novoId: () => 41,
  projeto: () => undefined,
  issueExiste: () => true,
  alcancaveis: () => [],
  depsConcluidas: () => true,
  execucaoAutonomaEmAndamento: () => false,
  temCommit: (id) => comCommit.includes(id),
});

const ticket = (id: number, etapa: Etapa, troca: Partial<Ticket> = {}): Ticket => ({
  id,
  issue: 1,
  etapa,
  titulo: `Ticket ${String(id)}`,
  descricao: "",
  status: "em_execucao",
  origem: "fabriquinha",
  criadoEm: ANTES,
  ...troca,
});

const evidencia = (id: number, tipo: Evidencia["tipo"]): Evidencia => ({
  id,
  ticket: 2,
  tipo,
  produtor: "agente",
  dados: {},
  arquivos: [],
  em: ANTES,
});

/**
 * I-1 em `desenho`: o desenho T-2 em execução (E-5 terminada), com as três evidências obrigatórias de um problema e o
 * ticket de desenvolvimento T-3 que ele propôs.
 */
const desenhado = (troca: Partial<Issue> = {}): Agregado => ({
  issue: {
    id: 1,
    projeto: "loja",
    titulo: "Login lento",
    tipo: "problema",
    descricao: "",
    fase: "desenho",
    deps: [],
    criadaEm: ANTES,
    ...troca,
  },
  tickets: [
    ticket(1, "registro", { status: "concluido", concluidoEm: ANTES }),
    ticket(2, "desenho"),
    ticket(3, "desenvolvimento", { status: "aberto", origem: "agente", origemTicket: 2 }),
  ],
  execucoes: [
    {
      id: 5,
      ticket: 2,
      modo: "autonomo",
      sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      resultado: "sucesso",
      iniciadaEm: ANTES,
      terminadaEm: ANTES,
    },
  ],
  decisoes: [],
  evidencias: [
    evidencia(1, "desenho_solucao"),
    evidencia(2, "relatorio_complexidade"),
    evidencia(3, "relatorio_impactos_arquitetura"),
  ],
});

const concluir = (ag: Agregado, entrada: unknown = { ticket: 2 }, ator: Ator = fabriquinha, ctx = contexto()) =>
  concluirTicket(ag, entrada, ator, ctx);

const regra = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeRegra && e.message === mensagem);
};

test("C7 do desenho: ticket concluído e a issue vai a aprovacao_desenho, com os tickets propostos intactos", () => {
  const ag = desenhado();
  assert.deepEqual(concluir(ag), {
    ...ag,
    issue: { ...ag.issue, fase: "aprovacao_desenho" },
    tickets: [ag.tickets[0], { ...ag.tickets[1], status: "concluido", concluidoEm: AGORA }, ag.tickets[2]],
  });
});

test("C7 do desenho exige as evidências do catálogo, com o protótipo só em funcionalidade", () => {
  const ag = desenhado();
  regra(
    () => concluir({ ...ag, evidencias: ag.evidencias.slice(1) }),
    "T-2 não pode concluir: falta a evidência desenho_solucao (o agente de T-2 submete com fabriquinha evidencia add desenho_solucao)",
  );
  const funcionalidade = desenhado({ tipo: "funcionalidade" });
  regra(
    () => concluir(funcionalidade),
    "T-2 não pode concluir: falta a evidência prototipo (o agente de T-2 submete com fabriquinha evidencia add prototipo)",
  );
  const comPrototipo = { ...funcionalidade, evidencias: [...ag.evidencias, evidencia(4, "prototipo")] };
  assert.equal(concluir(comPrototipo).issue.fase, "aprovacao_desenho");
});

test("C7 do desenho exige que ele tenha criado ao menos um ticket de desenvolvimento", () => {
  const ag = desenhado();
  const semProposta =
    "T-2 não pode concluir: o desenho não criou ticket de desenvolvimento " +
    "(o agente de T-2 cria com fabriquinha ticket criar I-1 --titulo <título>)";
  regra(() => concluir({ ...ag, tickets: ag.tickets.slice(0, 2) }), semProposta);
  // Ticket criado por outro (o Auditor, ou uma revisão) não conta para este desenho.
  const doAuditor = ticket(3, "desenvolvimento", { status: "aberto", origem: "auditor" });
  regra(() => concluir({ ...ag, tickets: [...ag.tickets.slice(0, 2), doAuditor] }), semProposta);
});

test("C7 é só da Fabriquinha, valida a entrada e exige ticket em execução, sem execução em andamento", () => {
  const ag = desenhado();
  assert.throws(() => concluir(ag, { ticket: 2 }, { tipo: "auditor" }), ErroDeEscopo);
  assert.throws(() => concluir(ag, { ticket: 2 }, { tipo: "agente", execucao: 5, ticket: 2 }), ErroDeEscopo);
  assert.throws(() => concluir(ag, { ticket: "T-2" }), ZodError);
  regra(() => concluir(ag, { ticket: 9 }), "o ticket T-9 não é da I-1 (confira o número do ticket)");
  regra(
    () => concluir(ag, { ticket: 1 }),
    "T-1 é de registro e não conclui por concluirTicket (o Auditor o conclui no gate de registro)",
  );
  const revisao = { ...ag, tickets: [...ag.tickets, ticket(4, "revisao")] };
  regra(
    () => concluir(revisao, { ticket: 4 }),
    "T-4 é da etapa revisao, que ainda não conclui (aguarde a versão que a implementa)",
  );
  const falhou = { ...ag, tickets: ag.tickets.map((t) => (t.id === 2 ? { ...t, status: "falhou" as const } : t)) };
  regra(() => concluir(falhou), "T-2 tem status falhou, não em_execucao (só se conclui ticket em execução)");
  const rodando = { ...ag, execucoes: ag.execucoes.map((e) => ({ ...e, resultado: "em_andamento" as const })) };
  regra(() => concluir(rodando), "T-2 não pode concluir: a execução E-5 ainda está em andamento (espere ela terminar)");
});

/**
 * I-1 em `desenvolvimento`: T-3 em execução (E-6 terminada) com as três evidências aprovadas, e T-4, outro ticket de
 * desenvolvimento, em `outro`.
 */
const desenvolvendo = (outro: Ticket["status"]): Agregado => {
  const ag = desenhado({ fase: "desenvolvimento" });
  const aprovada = (id: number, tipo: Evidencia["tipo"]): Evidencia => ({
    ...evidencia(id, tipo),
    ticket: 3,
    produtor: "fabriquinha",
    aprovada: true,
  });
  return {
    ...ag,
    tickets: [
      ...ag.tickets.slice(0, 2).map((t) => ({ ...t, status: "concluido" as const, concluidoEm: ANTES })),
      ticket(3, "desenvolvimento", { origem: "agente", origemTicket: 2 }),
      ticket(4, "desenvolvimento", {
        status: outro,
        origem: "agente",
        origemTicket: 2,
        ...(outro === "concluido" && { concluidoEm: ANTES }),
        ...(outro === "falhou" && { erro: "testes reprovados" }),
      }),
    ],
    execucoes: [{ ...ag.execucoes[0], id: 6, ticket: 3 } as Agregado["execucoes"][number]],
    evidencias: [
      ...ag.evidencias,
      aprovada(4, "execucao_testes"),
      aprovada(5, "matriz_fitness"),
      aprovada(6, "relatorio_sonar"),
    ],
  };
};

test("C7 do desenvolvimento: com outro ticket de desenvolvimento por concluir, aberto ou falho, a fase continua", () => {
  for (const outro of ["aberto", "falhou"] as const) {
    const ag = desenvolvendo(outro);
    assert.deepEqual(concluir(ag, { ticket: 3 }, fabriquinha, contexto([3])), {
      ...ag,
      tickets: ag.tickets.map((t) => (t.id === 3 ? { ...t, status: "concluido", concluidoEm: AGORA } : t)),
    });
  }
});

test("C7 do último ticket de desenvolvimento: fase revisao e um ticket de revisão novo", () => {
  const ag = desenvolvendo("concluido");
  const depois = concluir(ag, { ticket: 3 }, fabriquinha, contexto([3]));
  assert.equal(depois.issue.fase, "revisao");
  assert.deepEqual(depois.tickets.slice(2), [
    { ...ag.tickets[2], status: "concluido", concluidoEm: AGORA },
    ag.tickets[3],
    {
      id: 41,
      issue: 1,
      etapa: "revisao",
      titulo: "Revisar o desenvolvimento",
      descricao: "",
      status: "aberto",
      origem: "fabriquinha",
      criadoEm: AGORA,
    },
  ]);
});

test("C7 do desenvolvimento exige commit registrado do próprio ticket", () => {
  const ag = desenvolvendo("concluido");
  regra(
    () => concluir(ag, { ticket: 3 }, fabriquinha, contexto([4])),
    "T-3 não pode concluir: não tem commit registrado " +
      "(a Fabriquinha commita depois que testes, fitness e SonarQube aprovam; execute o ticket de novo)",
  );
});

test("C7 diz o que falta e o que está reprovado; evidência da Fabriquinha se resolve executando de novo", () => {
  const ag = desenvolvendo("concluido");
  const semTestes = {
    ...ag,
    evidencias: ag.evidencias
      .filter((e) => e.tipo !== "execucao_testes")
      .map((e) => (e.tipo === "relatorio_sonar" ? { ...e, aprovada: false } : e)),
  };
  regra(
    () => concluir(semTestes, { ticket: 3 }, fabriquinha, contexto([3])),
    "T-3 não pode concluir: falta a evidência execucao_testes; a evidência relatorio_sonar está reprovada " +
      "(a Fabriquinha coleta depois do pi; execute o ticket de novo)",
  );
  const reprovada = {
    ...ag,
    evidencias: ag.evidencias.map((e) => (e.tipo === "matriz_fitness" ? { ...e, aprovada: false } : e)),
  };
  regra(
    () => concluir(reprovada, { ticket: 3 }, fabriquinha, contexto([3])),
    "T-3 não pode concluir: a evidência matriz_fitness está reprovada " +
      "(a Fabriquinha coleta depois do pi; execute o ticket de novo)",
  );
});

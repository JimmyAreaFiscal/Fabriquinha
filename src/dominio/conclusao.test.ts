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

const contexto = (): Contexto => ({
  agora: AGORA,
  novoId: () => 41,
  projeto: () => undefined,
  issueExiste: () => true,
  alcancaveis: () => [],
  depsConcluidas: () => true,
  execucaoAutonomaEmAndamento: () => false,
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

const concluir = (ag: Agregado, entrada: unknown = { ticket: 2 }, ator: Ator = fabriquinha) =>
  concluirTicket(ag, entrada, ator, contexto());

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
  regra(
    () => concluir(ag, { ticket: 3 }),
    "T-3 é da etapa desenvolvimento, que ainda não conclui (aguarde a versão que a implementa)",
  );
  const falhou = { ...ag, tickets: ag.tickets.map((t) => (t.id === 2 ? { ...t, status: "falhou" as const } : t)) };
  regra(() => concluir(falhou), "T-2 tem status falhou, não em_execucao (só se conclui ticket em execução)");
  const rodando = { ...ag, execucoes: ag.execucoes.map((e) => ({ ...e, resultado: "em_andamento" as const })) };
  regra(() => concluir(rodando), "T-2 não pode concluir: a execução E-5 ainda está em andamento (espere ela terminar)");
});

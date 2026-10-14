import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import type { Agregado, Ator, Contexto, Execucao, PropostaIssue, Ticket } from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { decidirProposta, propostasAbertas, proporIssue } from "./propostas.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const ANTES = "2026-10-11T11:00:00.000Z";
const SESSAO = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const auditor: Ator = { tipo: "auditor" };
const agente = (ticket: number): Ator => ({ tipo: "agente", execucao: 6, ticket });

function contexto(): Contexto {
  const ids: Record<string, number> = {};
  return {
    agora: AGORA,
    novoId: (tipo) => (ids[tipo] = (ids[tipo] ?? 40) + 1),
    projeto: (nome) => (nome === "loja" ? ({} as never) : undefined),
    issueExiste: () => true,
    alcancaveis: () => [],
    depsConcluidas: () => true,
    temCommit: () => false,
  };
}

const ticket = (id: number, etapa: Ticket["etapa"], status: Ticket["status"]): Ticket => ({
  id,
  issue: 1,
  etapa,
  titulo: "Ticket",
  descricao: "",
  status,
  origem: "fabriquinha",
  criadoEm: ANTES,
  ...(status === "concluido" && { concluidoEm: ANTES }),
});

const EXECUCAO: Execucao = {
  id: 6,
  ticket: 34,
  modo: "interativo",
  sessaoPi: SESSAO,
  resultado: "em_andamento",
  iniciadaEm: ANTES,
};

/** I-1 em `registro`, com o ticket de registro T-34 em execução na E-6, interativa e em andamento. */
const noRegistro = (): Agregado => ({
  issue: {
    id: 1,
    projeto: "loja",
    titulo: "Relatórios",
    tipo: "funcionalidade",
    descricao: "",
    fase: "registro",
    deps: [],
    criadaEm: ANTES,
  },
  tickets: [ticket(34, "registro", "em_execucao")],
  execucoes: [
    { id: 6, ticket: 34, modo: "interativo", sessaoPi: SESSAO, resultado: "em_andamento", iniciadaEm: ANTES },
  ],
  decisoes: [],
  evidencias: [],
});

/** I-1 em `aprovacao_desenho`: registro T-34 e desenho T-35 concluídos, um ticket de desenvolvimento proposto. */
const noGateDoDesenho = (): Agregado => {
  const ag = noRegistro();
  return {
    ...ag,
    issue: { ...ag.issue, fase: "aprovacao_desenho" },
    tickets: [
      ticket(34, "registro", "concluido"),
      ticket(35, "desenho", "concluido"),
      ticket(36, "desenvolvimento", "aberto"),
    ],
    execucoes: [
      {
        id: 6,
        ticket: 35,
        modo: "autonomo",
        sessaoPi: SESSAO,
        resultado: "sucesso",
        iniciadaEm: ANTES,
        terminadaEm: ANTES,
      },
    ],
  };
};

const ENTRADA = { titulo: "Tela de relatório", mensagem: "Parte B: tela de relatório", arquivos: 31 };

const proposta = (troca: Partial<PropostaIssue> = {}): PropostaIssue => ({
  id: 3,
  ticket: 34,
  ...ENTRADA,
  status: "pendente",
  em: ANTES,
  ...troca,
});

const regra = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeRegra && e.message === mensagem);
};

test("C23: o agente do registro e o do desenho propõem, presa ao ticket dele", () => {
  assert.deepEqual(proporIssue(noRegistro(), ENTRADA, agente(34), contexto()), {
    id: 41,
    ticket: 34,
    ...ENTRADA,
    status: "pendente",
    em: AGORA,
  });
  const desenho = noRegistro();
  const emDesenho: Agregado = {
    ...desenho,
    issue: { ...desenho.issue, fase: "desenho" },
    tickets: [ticket(35, "desenho", "em_execucao")],
    execucoes: [{ ...EXECUCAO, ticket: 35, modo: "autonomo" }],
  };
  assert.equal(proporIssue(emDesenho, { ...ENTRADA, arquivos: 0 }, agente(35), contexto()).ticket, 35);
});

test("C23: recusa o Auditor, a Fabriquinha, outra etapa, execução terminada ou consulta", () => {
  const ag = noRegistro();
  assert.throws(() => proporIssue(ag, ENTRADA, auditor, contexto()), ErroDeEscopo);
  assert.throws(() => proporIssue(ag, ENTRADA, { tipo: "fabriquinha" }, contexto()), ErroDeEscopo);
  const dev: Agregado = { ...ag, tickets: [ticket(34, "desenvolvimento", "em_execucao")] };
  assert.throws(() => proporIssue(dev, ENTRADA, agente(34), contexto()), ErroDeEscopo);
  const terminada: Agregado = { ...ag, execucoes: [{ ...EXECUCAO, resultado: "sucesso", terminadaEm: ANTES }] };
  assert.throws(() => proporIssue(terminada, ENTRADA, agente(34), contexto()), ErroDeEscopo);
  const consulta: Agregado = { ...ag, execucoes: [{ ...EXECUCAO, modo: "consulta" }] };
  assert.throws(() => proporIssue(consulta, ENTRADA, agente(34), contexto()), ErroDeEscopo);
});

test("C23: valida título, mensagem e arquivos", () => {
  const ag = noRegistro();
  for (const ruim of [
    { ...ENTRADA, titulo: "" },
    { ...ENTRADA, mensagem: "  " },
    { ...ENTRADA, arquivos: -1 },
    { ...ENTRADA, arquivos: 1.5 },
    { titulo: "x", mensagem: "y" },
  ]) {
    assert.throws(() => proporIssue(ag, ruim, agente(34), contexto()), ZodError);
  }
});

test("C24: recusar no registro só marca a proposta", () => {
  const ag = noRegistro();
  const r = decidirProposta(ag, proposta(), { aceita: false }, auditor, contexto());
  assert.equal(r.ag, ag);
  assert.equal(r.nova, undefined);
  assert.deepEqual(r.proposta, { ...proposta(), status: "recusada", decididaEm: AGORA });
});

test("C24: aceitar no registro cria a issue nova dependente da atual e não toca na atual", () => {
  const ag = noRegistro();
  const r = decidirProposta(ag, proposta(), { aceita: true }, auditor, contexto());
  assert.equal(r.ag, ag);
  assert.deepEqual(r.proposta, { ...proposta(), status: "aceita", issueCriada: 41, decididaEm: AGORA });
  assert.equal(r.nova?.issue.id, 41);
  assert.deepEqual(r.nova.issue.deps, [1]);
  assert.equal(r.nova.issue.titulo, "Tela de relatório");
  assert.equal(r.nova.issue.descricao, "Parte B: tela de relatório");
  assert.equal(r.nova.issue.fase, "registro");
  assert.equal(r.nova.issue.projeto, "loja");
});

test("C24: aceitar no desenho cria a issue e devolve o desenho como reprovado, citando a nova", () => {
  const ag = noGateDoDesenho();
  const r = decidirProposta(ag, proposta({ ticket: 35 }), { aceita: true }, auditor, contexto());
  const motivo =
    "A Fabriquinha criou a I-41 («Tela de relatório») a partir da proposta de issue aceita pelo Auditor. " +
    "Refaça o desenho sem o que a I-41 assumiu; leia a descrição dela com fabriquinha issue ver I-41.";
  assert.equal(r.ag.issue.fase, "desenho");
  assert.deepEqual(
    r.ag.decisoes.map((d) => [d.gate, d.aprovado, d.motivo]),
    [["desenho", false, motivo]],
  );
  const refazer = r.ag.tickets.find((t) => t.status === "aberto");
  assert.deepEqual([refazer?.etapa, refazer?.descricao], ["desenho", motivo]);
  assert.equal(r.proposta.issueCriada, 41);
  assert.equal(r.nova?.issue.id, 41);
});

test("C24: recusar no desenho mantém o gate aberto", () => {
  const ag = noGateDoDesenho();
  const r = decidirProposta(ag, proposta({ ticket: 35 }), { aceita: false }, auditor, contexto());
  assert.equal(r.ag, ag);
  assert.equal(r.proposta.status, "recusada");
});

test("C24: só o Auditor decide e a entrada exige `aceita`", () => {
  const ag = noRegistro();
  assert.throws(() => decidirProposta(ag, proposta(), { aceita: true }, agente(34), contexto()), ErroDeEscopo);
  assert.throws(() => decidirProposta(ag, proposta(), {}, auditor, contexto()), ZodError);
  assert.throws(() => decidirProposta(ag, proposta(), { aceita: true, x: 1 }, auditor, contexto()), ZodError);
});

test("C24: proposta já decidida não se decide de novo", () => {
  const ag = noRegistro();
  regra(
    () =>
      decidirProposta(
        ag,
        proposta({ status: "aceita", issueCriada: 9, decididaEm: ANTES }),
        { aceita: true },
        auditor,
        contexto(),
      ),
    "a proposta P-3 já foi decidida: aceita (uma proposta só se decide uma vez)",
  );
  regra(
    () =>
      decidirProposta(ag, proposta({ status: "recusada", decididaEm: ANTES }), { aceita: false }, auditor, contexto()),
    "a proposta P-3 já foi decidida: recusada (uma proposta só se decide uma vez)",
  );
});

test("C24: recusa proposta de gate que já passou ou de outra issue", () => {
  const fora = "a proposta P-3 não está no gate atual da I-1 (o gate dela já passou ou ela é de outra issue)";
  // registro aprovado: a fase seguiu
  regra(() => decidirProposta(noGateDoDesenho(), proposta(), { aceita: true }, auditor, contexto()), fora);
  // desenho: a issue ainda não chegou ao gate, ou já saiu dele
  const desenhando: Agregado = { ...noGateDoDesenho(), issue: { ...noGateDoDesenho().issue, fase: "desenho" } };
  regra(() => decidirProposta(desenhando, proposta({ ticket: 35 }), { aceita: true }, auditor, contexto()), fora);
  // desenho antigo: o último concluído é o T-37
  const refeito = noGateDoDesenho();
  const outro: Agregado = { ...refeito, tickets: [...refeito.tickets, ticket(37, "desenho", "concluido")] };
  regra(() => decidirProposta(outro, proposta({ ticket: 35 }), { aceita: true }, auditor, contexto()), fora);
  // ticket de desenvolvimento ou de outra issue
  regra(
    () => decidirProposta(noGateDoDesenho(), proposta({ ticket: 36 }), { aceita: true }, auditor, contexto()),
    fora,
  );
  regra(() => decidirProposta(noRegistro(), proposta({ ticket: 99 }), { aceita: true }, auditor, contexto()), fora);
});

test("propostasAbertas: só as pendentes do gate atual", () => {
  const registro = noRegistro();
  const todas = [
    proposta({ id: 1 }),
    proposta({ id: 2, status: "recusada", decididaEm: ANTES }),
    proposta({ id: 3, ticket: 35 }),
  ];
  assert.deepEqual(
    propostasAbertas(registro, todas).map((p) => p.id),
    [1],
  );
  assert.deepEqual(
    propostasAbertas(noGateDoDesenho(), todas).map((p) => p.id),
    [3],
  );
});

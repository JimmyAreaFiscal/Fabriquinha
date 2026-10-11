import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import type { Agregado, Ator, Contexto, Ticket } from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import type { Etapa, Fase } from "./primitivos.ts";
import { adicionarTicketDesenvolvimento, editarTicket, removerTicket } from "./tickets.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const ANTES = "2026-10-11T11:00:00.000Z";
const auditor: Ator = { tipo: "auditor" };
const agente: Ator = { tipo: "agente", execucao: 5, ticket: 2 };
const MODELO = { provedor: "openai", modelo: "gpt-5" };

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
  status: "aberto",
  origem: "fabriquinha",
  criadoEm: ANTES,
  ...troca,
});

/**
 * I-1 na `fase`, com o ticket T-2 da `etapa` rodando na E-5, o T-3 que ele propôs e o T-4 que o Auditor propôs.
 * O agente da E-5 é `agente`.
 */
const comProposta = (fase: Fase = "desenho", etapa: Etapa = "desenho", andamento = true): Agregado => ({
  issue: {
    id: 1,
    projeto: "loja",
    titulo: "Login lento",
    tipo: "problema",
    descricao: "",
    fase,
    deps: [],
    criadaEm: ANTES,
  },
  tickets: [
    ticket(1, "registro", { status: "concluido", concluidoEm: ANTES }),
    ticket(2, etapa, { status: "em_execucao" }),
    ticket(3, "desenvolvimento", { origem: "agente", origemTicket: 2, descricao: "proposta" }),
    ticket(4, "desenvolvimento", { origem: "auditor" }),
  ],
  execucoes: [
    {
      id: 5,
      ticket: 2,
      modo: etapa === "sessao" ? "interativo" : "autonomo",
      sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      resultado: andamento ? "em_andamento" : "sucesso",
      iniciadaEm: ANTES,
      ...(!andamento && { terminadaEm: ANTES }),
    },
  ],
  decisoes: [],
  evidencias: [],
});

/** O gate de desenho: o desenho T-2 já concluiu e a execução dele terminou. */
const noGate = (): Agregado => {
  const ag = comProposta("aprovacao_desenho", "desenho", false);
  return {
    ...ag,
    tickets: ag.tickets.map((t) => (t.id === 2 ? { ...t, status: "concluido", concluidoEm: ANTES } : t)),
  };
};

const adicionar = (ag: Agregado, entrada: unknown, ator: Ator) =>
  adicionarTicketDesenvolvimento(ag, entrada, ator, contexto());

const escopo = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeEscopo && e.message === mensagem);
};
const regra = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeRegra && e.message === mensagem);
};

test("C11 do agente de desenho, revisão ou sessão: ticket de desenvolvimento aberto com origemTicket", () => {
  for (const [fase, etapa] of [
    ["desenho", "desenho"],
    ["revisao", "revisao"],
    ["ajuste_pr", "sessao"],
  ] as const) {
    const ag = comProposta(fase, etapa);
    assert.deepEqual(adicionar(ag, { titulo: "Cache do login" }, agente), {
      ...ag,
      tickets: [
        ...ag.tickets,
        ticket(41, "desenvolvimento", {
          titulo: "Cache do login",
          origem: "agente",
          origemTicket: 2,
          criadoEm: AGORA,
        }),
      ],
    });
  }
});

test("C11 do Auditor só no gate de desenho, e só ele escolhe o modelo", () => {
  const ag = noGate();
  assert.deepEqual(adicionar(ag, { titulo: "Índice", descricao: "d", modelo: MODELO }, auditor).tickets[4], {
    ...ticket(41, "desenvolvimento", { titulo: "Índice", descricao: "d", origem: "auditor", criadoEm: AGORA }),
    modelo: MODELO,
  });
  regra(
    () => adicionar(comProposta(), { titulo: "Índice" }, auditor),
    "o Auditor não pode criar ticket na I-1 na fase desenho (o Auditor só ajusta os tickets propostos no gate de desenho)",
  );
  escopo(
    () => adicionar(comProposta(), { titulo: "Índice", modelo: MODELO }, agente),
    "o agente não pode escolher o modelo do ticket (crie sem modelo; o Auditor o escolhe)",
  );
});

test("C11 recusa a Fabriquinha, o agente de outra etapa ou sem execução em andamento, e entrada inválida", () => {
  escopo(
    () => adicionar(comProposta(), { titulo: "x" }, { tipo: "fabriquinha" }),
    "a Fabriquinha não pode criar ticket na I-1 (quem pode é o Auditor ou o agente de desenho, revisao, sessao da I-1)",
  );
  escopo(
    () => adicionar(comProposta("encerramento", "encerramento"), { titulo: "x" }, agente),
    "o agente de T-2 não pode criar ticket na I-1 (quem pode é o Auditor ou o agente de desenho, revisao, sessao da I-1)",
  );
  escopo(
    () => adicionar(comProposta("desenho", "desenho", false), { titulo: "x" }, agente),
    "a execução E-5 já terminou (peça ao Auditor uma nova execução)",
  );
  assert.throws(() => adicionar(comProposta(), { titulo: " " }, agente), ZodError);
});

test("C12 muda só os campos informados, do ticket que o agente criou ou de qualquer um pelo Auditor no gate", () => {
  const ag = comProposta();
  const editado = editarTicket(ag, { ticket: 3, titulo: "Cache", descricao: undefined }, agente);
  assert.deepEqual(editado, {
    ...ag,
    tickets: ag.tickets.map((t) => (t.id === 3 ? { ...t, titulo: "Cache" } : t)),
  });
  const gate = noGate();
  assert.deepEqual(editarTicket(gate, { ticket: 3, descricao: "nova" }, auditor).tickets[2]?.descricao, "nova");
  assert.equal(editarTicket(gate, { ticket: 4, titulo: "Outro" }, auditor).tickets[3]?.titulo, "Outro");
});

test("C13 remove o ticket proposto, do agente que o criou ou pelo Auditor no gate", () => {
  const ag = comProposta();
  assert.deepEqual(removerTicket(ag, { ticket: 3 }, agente), { ...ag, tickets: ag.tickets.filter((t) => t.id !== 3) });
  assert.deepEqual(
    removerTicket(noGate(), { ticket: 4 }, auditor).tickets.map((t) => t.id),
    [1, 2, 3],
  );
});

test("C12 e C13: o agente só mexe no que criou, e só em ticket de desenvolvimento aberto", () => {
  const ag = comProposta();
  for (const [acao, mudar] of [
    ["editar", (entrada: object, ator: Ator, a = ag) => editarTicket(a, { ...entrada, titulo: "x" }, ator)],
    ["remover", (entrada: object, ator: Ator, a = ag) => removerTicket(a, entrada, ator)],
  ] as const) {
    escopo(
      () => mudar({ ticket: 4 }, agente),
      `o agente de T-2 não pode ${acao} T-4: T-4 não foi criado pela execução dele (cada agente ajusta só os tickets que criou)`,
    );
    const naoAberto =
      "não é um ticket de desenvolvimento aberto (só se ajusta ticket de desenvolvimento que ainda não executou)";
    regra(() => mudar({ ticket: 2 }, agente), `T-2 ${naoAberto}`);
    const rodando = {
      ...ag,
      tickets: ag.tickets.map((t) => (t.id === 3 ? { ...t, status: "em_execucao" as const } : t)),
    };
    regra(() => mudar({ ticket: 3 }, agente, rodando), `T-3 ${naoAberto}`);
    regra(() => mudar({ ticket: 9 }, agente), "o ticket T-9 não é da I-1 (confira o número do ticket)");
    regra(
      () => mudar({ ticket: 4 }, auditor),
      `o Auditor não pode ${acao} T-4 na fase desenho (o Auditor só ajusta os tickets propostos no gate de desenho)`,
    );
    assert.throws(() => mudar({ ticket: "T-3" }, agente), ZodError);
  }
});

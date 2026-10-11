import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import type { Agregado, Ator, Contexto, Evidencia, Issue, Ticket } from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { decidirDesenho, decidirRegistro } from "./gates.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const ANTES = "2026-10-11T11:00:00.000Z";
const auditor: Ator = { tipo: "auditor" };

function contexto(): Contexto {
  const ids: Record<string, number> = {};
  return {
    agora: AGORA,
    novoId: (tipo) => (ids[tipo] = (ids[tipo] ?? 40) + 1),
    projeto: () => undefined,
    issueExiste: () => true,
    alcancaveis: () => [],
    depsConcluidas: () => true,
    execucaoAutonomaEmAndamento: () => false,
  };
}

const evidencia = (id: number, tipo: Evidencia["tipo"], ticket = 34): Evidencia => ({
  id,
  ticket,
  tipo,
  produtor: "agente",
  dados: {},
  arquivos: [],
  em: ANTES,
});

/** I-1 em `registro`, com título e tipo, o ticket de registro T-34 em execução (E-6 terminada) e as duas evidências. */
const pronto = (troca: Partial<Issue> = {}): Agregado => ({
  issue: {
    id: 1,
    projeto: "loja",
    titulo: "Login lento",
    tipo: "problema",
    descricao: "",
    fase: "registro",
    deps: [],
    criadaEm: ANTES,
    ...troca,
  },
  tickets: [
    {
      id: 34,
      issue: 1,
      etapa: "registro",
      titulo: "Registrar a necessidade",
      descricao: "",
      status: "em_execucao",
      origem: "fabriquinha",
      criadoEm: ANTES,
    },
  ],
  execucoes: [
    {
      id: 6,
      ticket: 34,
      modo: "interativo",
      sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      resultado: "sucesso",
      iniciadaEm: ANTES,
      terminadaEm: ANTES,
    },
  ],
  decisoes: [],
  evidencias: [evidencia(1, "comportamento"), evidencia(2, "criterios_aceite")],
});

const decidir = (ag: Agregado, entrada: unknown, ator: Ator = auditor) =>
  decidirRegistro(ag, entrada, ator, contexto());

const regra = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeRegra && e.message === mensagem);
};

test("C10 aprovado: decisão do Auditor, ticket de registro concluído, fase desenho e ticket de desenho aberto", () => {
  const ag = pronto();
  assert.deepEqual(decidir(ag, { aprovado: true }), {
    ...ag,
    issue: { ...ag.issue, fase: "desenho" },
    tickets: [
      { ...ag.tickets[0], status: "concluido", concluidoEm: AGORA },
      {
        id: 41,
        issue: 1,
        etapa: "desenho",
        titulo: "Desenhar a solução",
        descricao: "",
        status: "aberto",
        origem: "fabriquinha",
        criadoEm: AGORA,
      },
    ],
    decisoes: [{ id: 41, issue: 1, ticket: 34, gate: "registro", aprovado: true, por: "auditor", em: AGORA }],
  });
  assert.equal(decidir(ag, { aprovado: true, motivo: "claro" }).decisoes[0]?.motivo, "claro");
  const outro: Ticket = {
    id: 30,
    issue: 1,
    etapa: "registro",
    titulo: "Registro antigo",
    descricao: "",
    status: "concluido",
    origem: "fabriquinha",
    criadoEm: ANTES,
    concluidoEm: ANTES,
  };
  const comOutro = decidir({ ...ag, tickets: [outro, ...ag.tickets] }, { aprovado: true });
  assert.deepEqual(comOutro.tickets[0], outro);
});

test("C10 reprovado só grava a decisão com o motivo, mesmo sem título, tipo nem evidências", () => {
  const ag = { ...pronto({ titulo: null, tipo: null }), evidencias: [] };
  assert.deepEqual(decidir(ag, { aprovado: false, motivo: "faltou o vídeo" }), {
    ...ag,
    decisoes: [
      {
        id: 41,
        issue: 1,
        ticket: 34,
        gate: "registro",
        aprovado: false,
        motivo: "faltou o vídeo",
        por: "auditor",
        em: AGORA,
      },
    ],
  });
});

test("C10 aprovado exige título, tipo e as evidências do registro no ticket de registro", () => {
  const semTitulo =
    "a I-1 não pode sair do registro sem título e tipo (o agente de T-34 os preenche com fabriquinha issue editar I-1)";
  regra(() => decidir(pronto({ titulo: null }), { aprovado: true }), semTitulo);
  regra(() => decidir(pronto({ tipo: null }), { aprovado: true }), semTitulo);
  regra(
    () =>
      decidir(
        { ...pronto(), evidencias: [evidencia(2, "criterios_aceite"), evidencia(3, "comportamento", 35)] },
        { aprovado: true },
      ),
    "T-34 não pode concluir: falta a evidência comportamento (o agente de T-34 submete com fabriquinha evidencia add comportamento)",
  );
  regra(
    () => decidir({ ...pronto(), evidencias: [] }, { aprovado: true }),
    "T-34 não pode concluir: falta a evidência comportamento, criterios_aceite (o agente de T-34 submete com " +
      "fabriquinha evidencia add comportamento e fabriquinha evidencia add criterios_aceite)",
  );
});

test("C10 é só do Auditor, na fase registro, sem execução em andamento, e valida a entrada", () => {
  const ag = pronto();
  assert.throws(() => decidir(ag, { aprovado: true }, { tipo: "agente", execucao: 6, ticket: 34 }), ErroDeEscopo);
  assert.throws(() => decidir(ag, { aprovado: true }, { tipo: "fabriquinha" }), ErroDeEscopo);
  assert.throws(() => decidir(ag, { aprovado: false }), ZodError);
  assert.throws(() => decidir(ag, { aprovado: false, motivo: " " }), ZodError);
  assert.throws(() => decidir(ag, {}), ZodError);
  regra(
    () => decidir(pronto({ fase: "desenho" }), { aprovado: true }),
    "a I-1 está na fase desenho, não no registro (o gate de registro já foi decidido)",
  );
  regra(
    () => decidir({ ...ag, tickets: [] }, { aprovado: true }),
    "a I-1 não tem ticket de registro aberto (registre a issue de novo)",
  );
  const rodando = { ...ag, execucoes: ag.execucoes.map((e) => ({ ...e, resultado: "em_andamento" as const })) };
  regra(
    () => decidir(rodando, { aprovado: false, motivo: "m" }),
    "T-34 não pode passar pelo gate: a execução E-6 ainda está em andamento (espere ela terminar)",
  );
});

const doGate = (id: number, etapa: Ticket["etapa"], troca: Partial<Ticket> = {}): Ticket => ({
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
const concluido = { status: "concluido", concluidoEm: ANTES } as const;

/**
 * I-1 no gate de desenho: um desenho antigo T-35 e o atual T-37, concluídos, e os tickets de desenvolvimento T-38,
 * proposto pelo desenho, e T-39, pelo Auditor.
 */
const noGate = (): Agregado => ({
  ...pronto({ fase: "aprovacao_desenho" }),
  tickets: [
    doGate(34, "registro", concluido),
    doGate(35, "desenho", concluido),
    doGate(37, "desenho", concluido),
    doGate(38, "desenvolvimento", { origem: "agente", origemTicket: 37 }),
    doGate(39, "desenvolvimento", { origem: "auditor" }),
  ],
});

const desenho = (ag: Agregado, entrada: unknown, ator: Ator = auditor) => decidirDesenho(ag, entrada, ator, contexto());

test("C15 aprovado: decisão sobre o último desenho e a issue vai a desenvolvimento com os tickets propostos", () => {
  const ag = noGate();
  assert.deepEqual(desenho(ag, { aprovado: true }), {
    ...ag,
    issue: { ...ag.issue, fase: "desenvolvimento" },
    decisoes: [{ id: 41, issue: 1, ticket: 37, gate: "desenho", aprovado: true, por: "auditor", em: AGORA }],
  });
});

test("C15 reprovado: remove os tickets abertos e volta a desenho com um ticket novo que traz o motivo", () => {
  const ag = noGate();
  assert.deepEqual(desenho(ag, { aprovado: false, motivo: "faltou o índice" }), {
    ...ag,
    issue: { ...ag.issue, fase: "desenho" },
    tickets: [
      ...ag.tickets.slice(0, 3),
      {
        id: 41,
        issue: 1,
        etapa: "desenho",
        titulo: "Refazer o desenho",
        descricao: "faltou o índice",
        status: "aberto",
        origem: "fabriquinha",
        criadoEm: AGORA,
      },
    ],
    decisoes: [
      {
        id: 41,
        issue: 1,
        ticket: 37,
        gate: "desenho",
        aprovado: false,
        motivo: "faltou o índice",
        por: "auditor",
        em: AGORA,
      },
    ],
  });
});

test("C15 é só do Auditor, no gate de desenho; aprovar exige ticket de desenvolvimento aberto", () => {
  const ag = noGate();
  assert.throws(() => desenho(ag, { aprovado: true }, { tipo: "agente", execucao: 6, ticket: 37 }), ErroDeEscopo);
  assert.throws(() => desenho(ag, { aprovado: false }), ZodError);
  regra(
    () => desenho({ ...ag, issue: { ...ag.issue, fase: "desenho" } }, { aprovado: true }),
    "a I-1 está na fase desenho, não na aprovação do desenho (o gate de desenho abre quando o ticket de desenho conclui)",
  );
  const semProposta = { ...ag, tickets: ag.tickets.slice(0, 3) };
  regra(
    () => desenho(semProposta, { aprovado: true }),
    "a I-1 não pode ir ao desenvolvimento sem ticket de desenvolvimento aberto (crie um ticket ou reprove o desenho)",
  );
  assert.equal(desenho(semProposta, { aprovado: false, motivo: "m" }).issue.fase, "desenho");
  regra(
    () => desenho({ ...ag, tickets: [] }, { aprovado: true }),
    "a I-1 não tem ticket de desenho concluído (conclua o desenho antes)",
  );
});

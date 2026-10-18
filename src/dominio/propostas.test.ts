import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import type { Agregado, Ator, Contexto, Execucao, PropostaIssue, Ticket } from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { decidirProposta, lotes, propostasAbertas, proporIssue } from "./propostas.ts";

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

/**
 * I-1 em `aprovacao_desenho`: registro T-34 concluído, desenho T-35 em execução e enviado (C25), um ticket de
 * desenvolvimento proposto.
 */
const noGateDoDesenho = (): Agregado => {
  const ag = noRegistro();
  return {
    ...ag,
    issue: { ...ag.issue, fase: "aprovacao_desenho" },
    tickets: [
      ticket(34, "registro", "concluido"),
      { ...ticket(35, "desenho", "em_execucao"), enviadoEm: ANTES },
      ticket(36, "desenvolvimento", "aberto"),
    ],
    execucoes: [
      {
        id: 6,
        ticket: 35,
        modo: "interativo",
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
  const r = decidirProposta(ag, proposta(), { aceita: false }, auditor, contexto(), [proposta()]);
  assert.equal(r.ag, ag);
  assert.equal(r.nova, undefined);
  assert.deepEqual(r.lote, [r.proposta]);
  assert.deepEqual(r.proposta, { ...proposta(), status: "recusada", decididaEm: AGORA });
});

test("C24: aceitar no registro cria a issue nova dependente da atual e não toca na atual", () => {
  const ag = noRegistro();
  const r = decidirProposta(ag, proposta(), { aceita: true }, auditor, contexto(), [proposta()]);
  assert.equal(r.ag, ag);
  assert.deepEqual(r.proposta, { ...proposta(), status: "aceita", issueCriada: 41, decididaEm: AGORA });
  assert.equal(r.nova?.issue.id, 41);
  assert.deepEqual(r.nova.issue.deps, [1]);
  assert.equal(r.nova.issue.titulo, "Tela de relatório");
  assert.equal(r.nova.issue.descricao, "Parte B: tela de relatório");
  assert.equal(r.nova.issue.fase, "registro");
  assert.equal(r.nova.issue.projeto, "loja");
});

test("C24: aceitar no desenho cria a issue e devolve o mesmo desenho à conversa, reprovado, citando a nova", () => {
  const ag = noGateDoDesenho();
  const r = decidirProposta(ag, proposta({ ticket: 35 }), { aceita: true }, auditor, contexto(), [
    proposta({ ticket: 35 }),
  ]);
  const motivo =
    "A Fabriquinha criou a I-41 («Tela de relatório») a partir da proposta de issue aceita pelo Auditor. " +
    "Refaça o desenho sem o que a I-41 assumiu; leia a descrição dela com fabriquinha issue ver I-41.";
  assert.equal(r.ag.issue.fase, "desenho");
  assert.deepEqual(
    r.ag.decisoes.map((d) => [d.gate, d.aprovado, d.motivo]),
    [["desenho", false, motivo]],
  );
  const desenho = r.ag.tickets.find((t) => t.id === 35);
  assert.deepEqual([desenho?.status, desenho?.enviadoEm], ["em_execucao", undefined]);
  assert.equal(r.proposta.issueCriada, 41);
  assert.equal(r.nova?.issue.id, 41);
});

test("C24: só o Auditor decide e a entrada exige `aceita`", () => {
  const ag = noRegistro();
  assert.throws(
    () => decidirProposta(ag, proposta(), { aceita: true }, agente(34), contexto(), [proposta()]),
    ErroDeEscopo,
  );
  assert.throws(() => decidirProposta(ag, proposta(), {}, auditor, contexto(), [proposta()]), ZodError);
  assert.throws(
    () => decidirProposta(ag, proposta(), { aceita: true, x: 1 }, auditor, contexto(), [proposta()]),
    ZodError,
  );
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
        [],
      ),
    "a proposta P-3 já foi decidida: aceita (uma proposta só se decide uma vez)",
  );
  regra(
    () =>
      decidirProposta(
        ag,
        proposta({ status: "recusada", decididaEm: ANTES }),
        { aceita: false },
        auditor,
        contexto(),
        [],
      ),
    "a proposta P-3 já foi decidida: recusada (uma proposta só se decide uma vez)",
  );
});

test("C24: recusa proposta de gate que já passou ou de outra issue", () => {
  const fora = "a proposta P-3 não está no gate atual da I-1 (o gate dela já passou ou ela é de outra issue)";
  // registro aprovado: a fase seguiu
  regra(
    () => decidirProposta(noGateDoDesenho(), proposta(), { aceita: true }, auditor, contexto(), [proposta()]),
    fora,
  );
  // desenho: a issue ainda não chegou ao gate, ou já saiu dele
  const desenhando: Agregado = { ...noGateDoDesenho(), issue: { ...noGateDoDesenho().issue, fase: "desenho" } };
  regra(
    () =>
      decidirProposta(desenhando, proposta({ ticket: 35 }), { aceita: true }, auditor, contexto(), [
        proposta({ ticket: 35 }),
      ]),
    fora,
  );
  // desenho antigo, já concluído: o desenho enviado é o T-37
  const refeito = noGateDoDesenho();
  const outro: Agregado = {
    ...refeito,
    tickets: refeito.tickets.map((t) => (t.id === 35 ? ticket(35, "desenho", "concluido") : t)),
  };
  regra(
    () =>
      decidirProposta(outro, proposta({ ticket: 35 }), { aceita: true }, auditor, contexto(), [
        proposta({ ticket: 35 }),
      ]),
    fora,
  );
  // ticket de desenvolvimento ou de outra issue
  regra(
    () => decidirProposta(noGateDoDesenho(), proposta({ ticket: 36 }), { aceita: true }, auditor, contexto(), []),
    fora,
  );
  regra(() => decidirProposta(noRegistro(), proposta({ ticket: 99 }), { aceita: true }, auditor, contexto(), []), fora);
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

const aceita = (id: number, ticket: number, issueCriada: number, troca: Partial<PropostaIssue> = {}): PropostaIssue =>
  proposta({ id, ticket, titulo: `Título ${String(id)}`, status: "aceita", issueCriada, decididaEm: ANTES, ...troca });
const aberta = (id: number, ticket: number, troca: Partial<PropostaIssue> = {}): PropostaIssue =>
  proposta({ id, ticket, titulo: `Título ${String(id)}`, ...troca });

test("lotes: uma proposta nova depois de todas decididas abre outro lote; pendente mantém o lote", () => {
  const T0 = "2026-10-11T08:00:00.000Z";
  const T1 = "2026-10-11T09:00:00.000Z";
  const T2 = "2026-10-11T10:00:00.000Z";
  const T3 = "2026-10-11T10:30:00.000Z";
  const ids = (ls: PropostaIssue[][]) => ls.map((l) => l.map((p) => p.id));
  assert.deepEqual(lotes([]), []);
  const rodadas = [
    aberta(2, 34, { em: T0, status: "recusada", decididaEm: T2 }),
    aberta(1, 34, { em: T0, status: "recusada", decididaEm: T1 }),
    aberta(3, 34, { em: T3, status: "recusada", decididaEm: AGORA }),
  ];
  assert.deepEqual(ids(lotes(rodadas)), [[1, 2], [3]]);
  // pendente criada no mesmo instante da decisão: continua no lote
  assert.deepEqual(
    ids(lotes([aberta(1, 34, { em: T0, status: "recusada", decididaEm: T1 }), aberta(2, 34, { em: T1 })])),
    [[1, 2]],
  );
  // lote com pendente: a seguinte entra nele, mesmo nascida depois de decisões
  assert.deepEqual(ids(lotes([aberta(1, 34, { em: T0 }), aberta(2, 34, { em: T3 })])), [[1, 2]]);
  assert.deepEqual(
    ids(lotes([aberta(1, 34, { em: T0, status: "recusada", decididaEm: T1 }), aberta(2, 34, { em: T3 })])),
    [[1], [2]],
  );
});

test("C24 no registro: a primeira de duas só decide; a última devolve o lote com as duas", () => {
  const ag = noRegistro();
  const p1 = aberta(1, 34);
  const p2 = aberta(2, 34);
  const primeira = decidirProposta(ag, p1, { aceita: true }, auditor, contexto(), [p1, p2]);
  assert.equal(primeira.lote, undefined);
  assert.equal(primeira.nova?.issue.id, 41);
  const ultima = decidirProposta(ag, p2, { aceita: false }, auditor, contexto(), [aceita(1, 34, 41), p2]);
  assert.equal(ultima.ag, ag);
  assert.deepEqual(
    ultima.lote?.map((p) => [p.id, p.status]),
    [
      [1, "aceita"],
      [2, "recusada"],
    ],
  );
});

test("C24 no desenho: o primeiro aceite não reprova; o último reprova com o motivo do lote", () => {
  const ag = noGateDoDesenho();
  const p1 = aberta(1, 35);
  const p2 = aberta(2, 35);
  const primeira = decidirProposta(ag, p1, { aceita: true }, auditor, contexto(), [p1, p2]);
  assert.equal(primeira.ag, ag);
  assert.equal(primeira.lote, undefined);
  const ultima = decidirProposta(ag, p2, { aceita: false }, auditor, contexto(), [aceita(1, 35, 41), p2]);
  const motivo = [
    "O Auditor decidiu as propostas de issue do desenho:",
    "- P-1 «Título 1»: aceita; a Fabriquinha criou a I-41 a partir dela (leia com fabriquinha issue ver I-41).",
    "- P-2 «Título 2»: recusada; a parte dela continua na I-1.",
    "Ajuste o desenho conforme essas decisões.",
  ].join("\n");
  assert.equal(ultima.ag.issue.fase, "desenho");
  assert.deepEqual(
    ultima.ag.decisoes.map((d) => [d.gate, d.aprovado, d.motivo]),
    [["desenho", false, motivo]],
  );
  assert.equal(ultima.nova, undefined);
  assert.equal(ultima.lote?.length, 2);
});

test("C24 no desenho: lote só de recusas também reprova, sem criar issue", () => {
  const ag = noGateDoDesenho();
  const p1 = aberta(1, 35, { status: "recusada", decididaEm: ANTES });
  const p2 = aberta(2, 35);
  const r = decidirProposta(ag, p2, { aceita: false }, auditor, contexto(), [p1, p2]);
  assert.equal(r.nova, undefined);
  assert.equal(r.ag.issue.fase, "desenho");
  assert.match(
    r.ag.decisoes[0]?.motivo ?? "",
    /^O Auditor decidiu as propostas de issue do desenho:\n- P-1 .*recusada.*\n- P-2 .*recusada/,
  );
});

test("C24: lote anterior já decidido não entra no lote que fecha", () => {
  const ag = noRegistro();
  const velha = aberta(1, 34, {
    em: "2026-10-11T08:00:00.000Z",
    status: "recusada",
    decididaEm: "2026-10-11T09:00:00.000Z",
  });
  const p2 = aberta(2, 34);
  const r = decidirProposta(ag, p2, { aceita: false }, auditor, contexto(), [velha, p2]);
  assert.deepEqual(
    r.lote?.map((p) => p.id),
    [2],
  );
});

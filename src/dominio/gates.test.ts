import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import type { Agregado, Ator, Contexto, EstadoDoPR, Evidencia, Issue, Ticket } from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { decidirDesenho, decidirPR, decidirRegistro, enviarParaAprovacao, registrarDecisaoRevisao } from "./gates.ts";

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
    temCommit: () => false,
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

/**
 * I-1 em `registro`, com título e tipo, o ticket de registro T-34 em execução e enviado à aprovação (C25, E-6
 * terminada) e as duas evidências.
 */
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
      enviadoEm: ANTES,
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

test("C10 reprovado grava a decisão com o motivo e devolve o ticket à conversa, mesmo sem título nem evidências", () => {
  const ag = { ...pronto({ titulo: null, tipo: null }), evidencias: [] };
  const [registro] = ag.tickets;
  assert.ok(registro);
  const { enviadoEm: _devolvido, ...conversando } = registro;
  assert.deepEqual(decidir(ag, { aprovado: false, motivo: "faltou o vídeo" }), {
    ...ag,
    tickets: [conversando],
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
  const naoEnviado =
    "o registro da I-1 ainda não foi enviado à aprovação (o agente envia com fabriquinha ticket enviar quando você " +
    "confirmar o resultado na conversa)";
  regra(() => decidir({ ...ag, tickets: [] }, { aprovado: true }), naoEnviado);
  const conversando = ag.tickets.map(({ enviadoEm: _e, ...t }) => t);
  regra(() => decidir({ ...ag, tickets: conversando }, { aprovado: false, motivo: "m" }), naoEnviado);
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
 * I-1 no gate de desenho: um desenho antigo T-35, concluído, e o atual T-37, em execução e enviado (C25), e os tickets
 * de desenvolvimento T-38, proposto pelo desenho, e T-39, pelo Auditor.
 */
const noGate = (): Agregado => ({
  ...pronto({ fase: "aprovacao_desenho" }),
  tickets: [
    doGate(34, "registro", concluido),
    doGate(35, "desenho", concluido),
    doGate(37, "desenho", { status: "em_execucao", enviadoEm: ANTES }),
    doGate(38, "desenvolvimento", { origem: "agente", origemTicket: 37 }),
    doGate(39, "desenvolvimento", { origem: "auditor" }),
  ],
});

const desenho = (ag: Agregado, entrada: unknown, ator: Ator = auditor) => decidirDesenho(ag, entrada, ator, contexto());

test("C15 aprovado: conclui o desenho enviado e a issue vai a desenvolvimento com os tickets propostos", () => {
  const ag = noGate();
  assert.deepEqual(desenho(ag, { aprovado: true }), {
    ...ag,
    issue: { ...ag.issue, fase: "desenvolvimento" },
    tickets: ag.tickets.map((t) => (t.id === 37 ? { ...t, status: "concluido", concluidoEm: AGORA } : t)),
    decisoes: [{ id: 41, issue: 1, ticket: 37, gate: "desenho", aprovado: true, por: "auditor", em: AGORA }],
  });
});

test("C15 reprovado: volta a desenho com o mesmo ticket, de volta à conversa, e os mesmos tickets propostos", () => {
  const ag = noGate();
  assert.deepEqual(desenho(ag, { aprovado: false, motivo: "faltou o índice" }), {
    ...ag,
    issue: { ...ag.issue, fase: "desenho" },
    tickets: ag.tickets.map(({ enviadoEm: _devolvido, ...t }) => t),
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
    "a I-1 está na fase desenho, não na aprovação do desenho (o gate de desenho abre quando o agente envia o desenho)",
  );
  const semProposta = { ...ag, tickets: ag.tickets.slice(0, 3) };
  const rodando = {
    ...ag,
    execucoes: [...ag.execucoes.map((e) => ({ ...e, ticket: 37, resultado: "em_andamento" as const }))],
  };
  regra(
    () => desenho(rodando, { aprovado: true }),
    "T-37 não pode passar pelo gate: a execução E-6 ainda está em andamento (espere ela terminar)",
  );
  regra(
    () => desenho(semProposta, { aprovado: true }),
    "a I-1 não pode ir ao desenvolvimento sem ticket de desenvolvimento aberto (crie um ticket ou reprove o desenho)",
  );
  assert.equal(desenho(semProposta, { aprovado: false, motivo: "m" }).issue.fase, "desenho");
  regra(
    () => desenho({ ...ag, tickets: [] }, { aprovado: true }),
    "o desenho da I-1 ainda não foi enviado à aprovação (o agente envia com fabriquinha ticket enviar quando você " +
      "confirmar o resultado na conversa)",
  );
});

/**
 * C25: o agente com a execução E-6 em andamento no ticket `etapa` T-37 de I-1, na fase da etapa, com as evidências
 * dela; o desenho propôs o T-38.
 */
function enviando(etapa: "registro" | "desenho", troca: Partial<Issue> = {}): Agregado {
  const base = pronto({ fase: etapa, ...troca });
  const tipos = etapa === "registro" ? (["comportamento", "criterios_aceite"] as const) : DO_DESENHO;
  return {
    ...base,
    tickets: [
      doGate(34, "registro", concluido),
      doGate(37, etapa, { status: "em_execucao" }),
      doGate(38, "desenvolvimento", { origem: "agente", origemTicket: 37 }),
    ],
    execucoes: base.execucoes.map((e) => ({ ...e, ticket: 37, resultado: "em_andamento" as const })),
    evidencias: tipos.map((tipo, i) => evidencia(i + 1, tipo, 37)),
  };
}
const DO_DESENHO = ["desenho_solucao", "relatorio_complexidade", "relatorio_impactos_arquitetura"] as const;
const agente37: Ator = { tipo: "agente", execucao: 6, ticket: 37 };
const enviar = (ag: Agregado, ator: Ator = agente37, ticket = 37) =>
  enviarParaAprovacao(ag, { ticket }, ator, contexto());

test("C25 do registro: o ticket fica enviado, em execução, e a issue continua no registro", () => {
  const ag = enviando("registro");
  assert.deepEqual(enviar(ag), {
    ...ag,
    tickets: ag.tickets.map((t) => (t.id === 37 ? { ...t, enviadoEm: AGORA } : t)),
  });
});

test("C25 do desenho: o ticket fica enviado, em execução, e a issue vai a aprovacao_desenho", () => {
  const ag = enviando("desenho");
  assert.deepEqual(enviar(ag), {
    ...ag,
    issue: { ...ag.issue, fase: "aprovacao_desenho" },
    tickets: ag.tickets.map((t) => (t.id === 37 ? { ...t, enviadoEm: AGORA } : t)),
  });
});

test("C25 exige o que o gate exige: título, tipo e evidências no registro; evidências e ticket criado no desenho", () => {
  regra(
    () => enviar(enviando("registro", { tipo: null })),
    "a I-1 não pode sair do registro sem título e tipo (o agente de T-37 os preenche com fabriquinha issue editar I-1)",
  );
  regra(
    () => enviar({ ...enviando("registro"), evidencias: [] }),
    "T-37 não pode ir à aprovação: falta a evidência comportamento, criterios_aceite (o agente de T-37 submete com " +
      "fabriquinha evidencia add comportamento e fabriquinha evidencia add criterios_aceite)",
  );
  const desenhando = enviando("desenho");
  regra(
    () => enviar({ ...desenhando, evidencias: desenhando.evidencias.slice(1) }),
    "T-37 não pode ir à aprovação: falta a evidência desenho_solucao (o agente de T-37 submete com fabriquinha " +
      "evidencia add desenho_solucao)",
  );
  regra(
    () => enviar({ ...desenhando, tickets: desenhando.tickets.slice(0, 2) }),
    "T-37 não pode ir à aprovação: o desenho não criou ticket de desenvolvimento (o agente de T-37 cria com fabriquinha " +
      "ticket criar I-1 --titulo <título>)",
  );
});

test("C25 é só do agente do próprio ticket de registro ou desenho, em execução, e uma vez até a decisão", () => {
  const ag = enviando("desenho");
  assert.throws(() => enviar(ag, auditor), ErroDeEscopo);
  assert.throws(() => enviar(ag, { tipo: "agente", execucao: 6, ticket: 38 }), ErroDeEscopo);
  assert.throws(() => enviarParaAprovacao(ag, { ticket: "T-37" }, agente37, contexto()), ZodError);
  const terminada = { ...ag, execucoes: ag.execucoes.map((e) => ({ ...e, resultado: "sucesso" as const })) };
  assert.throws(() => enviar(terminada), ErroDeEscopo);
  const revisao = {
    ...ag,
    tickets: ag.tickets.map((t) => (t.id === 37 ? { ...t, etapa: "revisao" as const } : t)),
  };
  regra(() => enviar(revisao), "T-37 é de revisao (só o registro e o desenho vão à aprovação do Auditor)");
  regra(
    () => enviar(enviar(ag)),
    "T-37 já foi enviado e espera a decisão do Auditor (termine a sua resposta; se ele devolver, o motivo chega " +
      "nesta conversa)",
  );
});

/** I-1 em `revisao`: a revisão T-40 em execução pela E-7, autônoma, com uma decisão antiga da revisão T-36. */
const revisando = (): Agregado => ({
  ...pronto({ fase: "revisao" }),
  tickets: [
    doGate(34, "registro", concluido),
    doGate(36, "revisao", concluido),
    doGate(39, "desenho", { status: "em_execucao" }),
    doGate(40, "revisao", { status: "em_execucao" }),
  ],
  execucoes: [
    {
      id: 7,
      ticket: 40,
      modo: "autonomo",
      sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      resultado: "em_andamento",
      iniciadaEm: ANTES,
    },
  ],
  decisoes: [{ id: 3, issue: 1, ticket: 36, gate: "revisao", aprovado: true, por: "agente", em: ANTES }],
});
const revisor: Ator = { tipo: "agente", execucao: 7, ticket: 40 };

test("C14 grava a decisão do agente revisor e, na mesma execução, a substitui", () => {
  const ag = revisando();
  const ctx = contexto();
  const aprovada = registrarDecisaoRevisao(ag, { ticket: 40, aprovado: true }, revisor, ctx);
  assert.deepEqual(aprovada, {
    ...ag,
    decisoes: [
      ...ag.decisoes,
      { id: 41, issue: 1, ticket: 40, gate: "revisao", aprovado: true, por: "agente", em: AGORA },
    ],
  });
  const reprovada = registrarDecisaoRevisao(
    aprovada,
    { ticket: 40, aprovado: false, motivo: "falta o índice" },
    revisor,
    ctx,
  );
  assert.deepEqual(reprovada.decisoes, [
    ...ag.decisoes,
    {
      id: 42,
      issue: 1,
      ticket: 40,
      gate: "revisao",
      aprovado: false,
      motivo: "falta o índice",
      por: "agente",
      em: AGORA,
    },
  ]);
  assert.throws(() => registrarDecisaoRevisao(ag, { ticket: 40, aprovado: false }, revisor, ctx), ZodError);
});

test("C14 é só do agente da própria revisão, em execução", () => {
  const ag = revisando();
  const decidirRevisao = (ator: Ator, ticket = 40, agregado = ag) =>
    registrarDecisaoRevisao(agregado, { ticket, aprovado: true }, ator, contexto());
  const escopo = (trabalho: () => unknown, mensagem: string) => {
    assert.throws(trabalho, (e) => e instanceof ErroDeEscopo && e.message === mensagem);
  };
  const soOAgente =
    "só o agente de T-40 pode registrar a decisão de revisão dele (cada revisão é decidida pelo próprio agente revisor)";
  escopo(() => decidirRevisao(auditor), soOAgente);
  escopo(() => decidirRevisao({ tipo: "fabriquinha" }), soOAgente);
  escopo(() => decidirRevisao({ tipo: "agente", execucao: 7, ticket: 39 }), soOAgente);
  const terminou = {
    ...ag,
    execucoes: ag.execucoes.map((e) => ({ ...e, resultado: "sucesso" as const, terminadaEm: AGORA })),
  };
  escopo(() => decidirRevisao(revisor, 40, terminou), "a execução E-7 já terminou (peça ao Auditor uma nova execução)");
  const doDesenho = { ...ag, execucoes: ag.execucoes.map((e) => ({ ...e, ticket: 39 })) };
  regra(
    () => decidirRevisao({ tipo: "agente", execucao: 7, ticket: 39 }, 39, doDesenho),
    "T-39 é de desenho e está em_execucao, não é uma revisão em execução (só a revisão registra a decisão de revisão)",
  );
  const concluida = { ...ag, tickets: ag.tickets.map((t) => (t.id === 40 ? { ...t, ...concluido } : t)) };
  regra(
    () => decidirRevisao(revisor, 40, concluida),
    "T-40 é de revisao e está concluido, não é uma revisão em execução (só a revisão registra a decisão de revisão)",
  );
});

/** I-1 no gate do PR: o encerramento antigo T-44 e o atual T-46, concluídos. */
const noGatePR = (): Agregado => ({
  ...pronto({ fase: "aprovacao_pr" }),
  tickets: [
    doGate(34, "registro", concluido),
    doGate(44, "encerramento", concluido),
    doGate(46, "encerramento", concluido),
  ],
});

const pr = (ag: Agregado, entrada: unknown, estadoPR?: EstadoDoPR, ator: Ator = auditor) =>
  decidirPR(ag, entrada, ator, { ...contexto(), ...(estadoPR && { estadoPR }) });

test("C16 aprovado com o PR mergeado: decisão com a nota sobre o último encerramento e a issue concluída", () => {
  const ag = noGatePR();
  assert.deepEqual(pr(ag, { aprovado: true, nota: 4 }, "mergeado"), {
    ...ag,
    issue: { ...ag.issue, fase: "concluida", concluidaEm: AGORA },
    decisoes: [{ id: 41, issue: 1, ticket: 46, gate: "pr", aprovado: true, nota: 4, por: "auditor", em: AGORA }],
  });
});

test("C16 reprovado com o PR não mergeado: fase ajuste_pr e um ticket sessao com o motivo na descrição", () => {
  const ag = noGatePR();
  const esperado = (estado: EstadoDoPR) => {
    assert.deepEqual(pr(ag, { aprovado: false, motivo: "falta o índice" }, estado), {
      ...ag,
      issue: { ...ag.issue, fase: "ajuste_pr" },
      tickets: [
        ...ag.tickets,
        {
          id: 41,
          issue: 1,
          etapa: "sessao",
          titulo: "Ajustar o PR",
          descricao: "falta o índice",
          status: "aberto",
          origem: "fabriquinha",
          criadoEm: AGORA,
        },
      ],
      decisoes: [
        {
          id: 41,
          issue: 1,
          ticket: 46,
          gate: "pr",
          aprovado: false,
          motivo: "falta o índice",
          por: "auditor",
          em: AGORA,
        },
      ],
    });
  };
  esperado("aberto");
  esperado("fechado");
});

test("C16 é só do Auditor, no gate do PR, com o estado lido: encerrar só mergeado, pedir mudanças só não mergeado", () => {
  const ag = noGatePR();
  assert.throws(
    () => pr(ag, { aprovado: true, nota: 4 }, "mergeado", { tipo: "agente", execucao: 6, ticket: 46 }),
    ErroDeEscopo,
  );
  assert.throws(() => pr(ag, { aprovado: true }, "mergeado"), ZodError, "encerrar sem nota");
  assert.throws(() => pr(ag, { aprovado: true, nota: 6 }, "mergeado"), ZodError, "nota fora de 1 a 5");
  assert.throws(() => pr(ag, { aprovado: false }, "aberto"), ZodError, "pedir mudanças sem motivo");
  assert.throws(() => pr(ag, { aprovado: false, motivo: "m", nota: 3 }, "aberto"), ZodError, "pedir mudanças com nota");
  regra(
    () => pr({ ...ag, issue: { ...ag.issue, fase: "encerramento" } }, { aprovado: true, nota: 4 }, "mergeado"),
    "a I-1 está na fase encerramento, não na aprovação do PR (o gate do PR abre quando o encerramento publica o PR)",
  );
  regra(
    () => pr({ ...ag, tickets: ag.tickets.slice(0, 1) }, { aprovado: true, nota: 4 }, "mergeado"),
    "a I-1 não tem ticket de encerramento concluído (confira o banco)",
  );
  regra(
    () => pr(ag, { aprovado: true, nota: 4 }),
    "o estado do PR da I-1 não foi lido (leia o PR na plataforma logo antes de decidir)",
  );
  for (const estado of ["aberto", "fechado"] as const) {
    regra(
      () => pr(ag, { aprovado: true, nota: 4 }, estado),
      `a I-1 não pode ser encerrada: o PR está ${estado}, não mergeado (faça o merge na plataforma, com merge commit, e encerre de novo)`,
    );
  }
  regra(
    () => pr(ag, { aprovado: false, motivo: "m" }, "mergeado"),
    "a I-1 não pode pedir mudanças: o PR já foi mergeado (encerre a issue com a nota)",
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import {
  type Agregado,
  type Ator,
  CANCELADA,
  type Contexto,
  type Execucao,
  exigirNaoCancelada,
  type Issue,
  type ModoExecucao,
  type Ticket,
} from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import {
  adicionarDependencia,
  arquivarConcluidas,
  cancelarIssue,
  editarIssue,
  registrarIssue,
  removerDependencia,
} from "./issue.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };
const agente = (ticket: number, execucao = 7): Ator => ({ tipo: "agente", execucao, ticket });

/** Contexto falso: issues 1..10 existem e `grafo` diz de quem cada uma depende. */
function contexto(grafo: Record<number, number[]> = {}): Contexto {
  const ids: Record<string, number> = {};
  const alcancaveis = (id: number): number[] => {
    const vistos = new Set<number>();
    const pilha = [...(grafo[id] ?? [])];
    for (let atual = pilha.pop(); atual !== undefined; atual = pilha.pop()) {
      if (!vistos.has(atual)) pilha.push(...(grafo[atual] ?? []));
      vistos.add(atual);
    }
    return [...vistos];
  };
  return {
    agora: AGORA,
    novoId: (tipo) => (ids[tipo] = (ids[tipo] ?? 40) + 1),
    projeto: (nome) =>
      nome === "loja"
        ? {
            nome,
            repo: "/r",
            branchBase: "main",
            hospedagem: "github",
            preparacao: [],
            testes: ["t"],
            sonar: { projectKey: "k" },
            fitness: [{ nome: "f", comando: "c", descricao: "d" }],
            modelos: {},
          }
        : undefined,
    issueExiste: (id) => id >= 1 && id <= 10,
    alcancaveis,
    depsConcluidas: () => true,
    execucaoAutonomaEmAndamento: () => false,
    temCommit: () => false,
  };
}

const execucao = (id: number, modo: ModoExecucao, ticket = 34): Execucao => ({
  id,
  ticket,
  modo,
  sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  resultado: "em_andamento",
  iniciadaEm: AGORA,
});

/**
 * I-1 em `registro` com o ticket de registro T-34 rodando na E-7, depois da E-6 já terminada; T-35 é um ticket de
 * desenho de outra etapa.
 */
const base = (troca: Partial<Issue> = {}): Agregado => ({
  issue: {
    id: 1,
    projeto: "loja",
    titulo: null,
    tipo: null,
    descricao: "",
    fase: "registro",
    deps: [],
    criadaEm: AGORA,
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
      criadoEm: AGORA,
    },
    {
      id: 35,
      issue: 1,
      etapa: "desenho",
      titulo: "Desenhar",
      descricao: "",
      status: "aberto",
      origem: "fabriquinha",
      criadoEm: AGORA,
    },
  ],
  execucoes: [{ ...execucao(6, "interativo"), resultado: "sucesso", terminadaEm: AGORA }, execucao(7, "interativo")],
  decisoes: [],
  evidencias: [],
});

const regra = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeRegra && e.message === mensagem);
};
const escopo = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeEscopo && e.message === mensagem);
};

test("C1 cria a issue em registro, sem título e tipo, com o ticket de registro aberto", () => {
  assert.deepEqual(registrarIssue({ projeto: "loja", deps: [3, 2, 3] }, auditor, contexto()), {
    issue: {
      id: 41,
      projeto: "loja",
      titulo: null,
      tipo: null,
      descricao: "",
      fase: "registro",
      deps: [3, 2],
      criadaEm: AGORA,
    },
    tickets: [
      {
        id: 41,
        issue: 41,
        etapa: "registro",
        titulo: "Registrar a necessidade",
        descricao: "",
        status: "aberto",
        origem: "fabriquinha",
        criadoEm: AGORA,
      },
    ],
    execucoes: [],
    decisoes: [],
    evidencias: [],
  });
  assert.deepEqual(registrarIssue({ projeto: "loja" }, auditor, contexto()).issue.deps, []);
});

test("C1 grava a descrição informada na issue; sem ela, fica vazia", () => {
  const com = registrarIssue({ projeto: "loja", descricao: "Exportar pedidos em CSV" }, auditor, contexto());
  assert.equal(com.issue.descricao, "Exportar pedidos em CSV");
  assert.equal(registrarIssue({ projeto: "loja" }, auditor, contexto()).issue.descricao, "");
  assert.throws(() => registrarIssue({ projeto: "loja", descricao: "a ".repeat(1001) }, auditor, contexto()), ZodError);
});

test("C1 é só do Auditor, exige projeto e deps existentes e valida a entrada", () => {
  for (const ator of [agente(34), fabriquinha]) {
    escopo(
      () => registrarIssue({ projeto: "loja" }, ator, contexto()),
      "só o Auditor pode registrar uma issue (peça ao Auditor pelo web)",
    );
  }
  regra(
    () => registrarIssue({ projeto: "outro" }, auditor, contexto()),
    "o projeto outro não existe (cadastre-o na Configuração)",
  );
  regra(
    () => registrarIssue({ projeto: "loja", deps: [2, 99] }, auditor, contexto()),
    "a issue I-99 não existe (confira o número da issue)",
  );
  assert.throws(() => registrarIssue({ projeto: "Loja" }, auditor, contexto()), ZodError);
  assert.throws(() => registrarIssue({ projeto: "loja", deps: [0] }, auditor, contexto()), ZodError);
});

test("C2 muda só os campos informados; ausente ou undefined mantém o valor", () => {
  const ag = base({ titulo: "Antigo", descricao: "texto" });
  const depois = editarIssue(ag, { titulo: "  Novo  ", tipo: "problema", descricao: undefined }, auditor);
  assert.deepEqual(depois, { ...ag, issue: { ...ag.issue, titulo: "Novo", tipo: "problema" } });
  assert.deepEqual(editarIssue(ag, {}, auditor), ag);
  assert.equal(editarIssue(ag, { descricao: "outra" }, agente(34)).issue.descricao, "outra");
  assert.throws(() => editarIssue(ag, { titulo: "a\nb" }, auditor), ZodError);
  assert.throws(() => editarIssue(ag, { tipo: "bug" }, auditor), ZodError);
  assert.throws(() => editarIssue(ag, { descricao: "p ".repeat(1001) }, auditor), ZodError);
});

test("C2 só na fase registro", () => {
  const ag = base({ fase: "desenho", titulo: "T", tipo: "problema" });
  regra(
    () => editarIssue(ag, { titulo: "Outro" }, auditor),
    "a I-1 está na fase desenho: título, tipo e descrição só mudam no registro (registre uma nova issue para a mudança)",
  );
});

test("C2, C3 e C4: agente só pelo ticket de registro da issue e com a execução dele em andamento", () => {
  const casos: [(ag: Agregado, ator: Ator) => unknown, string][] = [
    [(ag, ator) => editarIssue(ag, { titulo: "T" }, ator), "editar a I-1"],
    [(ag, ator) => adicionarDependencia(ag, 2, ator, contexto()), "mudar as dependências da I-1"],
    [(ag, ator) => removerDependencia(ag, 2, ator), "mudar as dependências da I-1"],
  ];
  const quem = "quem pode é o Auditor ou o agente de registro da I-1";
  // E-9 roda o T-35, não o T-34; E-7 numa consulta não altera nada (F4 §6.5).
  const outroTicket = { ...base(), execucoes: [...base().execucoes, execucao(9, "autonomo", 35)] };
  const consulta = { ...base(), execucoes: [execucao(7, "consulta")] };
  const terminou = (id: number) => `a execução E-${String(id)} já terminou (peça ao Auditor uma nova execução)`;
  for (const [comando, acao] of casos) {
    assert.ok(comando(base(), agente(34)));
    escopo(() => comando(base(), fabriquinha), `a Fabriquinha não pode ${acao} (${quem})`);
    escopo(() => comando(base(), agente(35)), `o agente de T-35 não pode ${acao} (${quem})`);
    escopo(() => comando(base(), agente(99)), `o agente de T-99 não pode ${acao} (${quem})`);
    escopo(() => comando(base(), agente(34, 8)), terminou(8));
    escopo(() => comando(base(), agente(34, 6)), terminou(6));
    escopo(() => comando(outroTicket, agente(34, 9)), terminou(9));
    escopo(
      () => comando(consulta, agente(34)),
      `a execução E-7 é uma consulta, que só pergunta e não pode ${acao} (peça ao Auditor que faça a mudança)`,
    );
  }
});

test("C3 adiciona, é idempotente e vale entre projetos", () => {
  const ag = base({ deps: [2] });
  const depois = adicionarDependencia(ag, 3, auditor, contexto({ 3: [4] }));
  assert.deepEqual(depois.issue.deps, [2, 3]);
  assert.equal(adicionarDependencia(depois, 3, auditor, contexto()), depois);
  assert.deepEqual(
    adicionarDependencia(base({ fase: "aprovacao_pr", titulo: "T", tipo: "problema" }), 5, auditor, contexto()).issue
      .deps,
    [5],
  );
  assert.throws(() => adicionarDependencia(ag, "I-3", auditor, contexto()), ZodError);
});

test("C3 recusa autorreferência, issue inexistente, ciclo e issue concluída", () => {
  regra(
    () => adicionarDependencia(base(), 1, auditor, contexto()),
    "a I-1 não pode depender de si mesma (informe outra issue)",
  );
  regra(
    () => adicionarDependencia(base(), 11, auditor, contexto()),
    "a issue I-11 não existe (confira o número da issue)",
  );
  regra(
    () => adicionarDependencia(base(), 2, auditor, contexto({ 2: [3], 3: [1] })),
    "a I-1 não pode depender da I-2: a I-2 já depende da I-1 e isso fecharia um ciclo (remova antes uma das dependências do ciclo)",
  );
  const concluida = base({ fase: "concluida", titulo: "T", tipo: "problema", concluidaEm: AGORA });
  const mensagem = "a I-1 está concluída e as dependências dela não mudam mais (registre uma nova issue se precisar)";
  regra(() => adicionarDependencia(concluida, 2, auditor, contexto()), mensagem);
  regra(() => removerDependencia(concluida, 2, auditor), mensagem);
});

test("C4 remove e é idempotente", () => {
  const ag = base({ deps: [2, 3] });
  const depois = removerDependencia(ag, 2, auditor);
  assert.deepEqual(depois.issue.deps, [3]);
  assert.equal(removerDependencia(depois, 2, auditor), depois);
});

test("C18 arquiva só as concluídas ainda não arquivadas e é só do Auditor", () => {
  const issue = (id: number, troca: Partial<Issue>): Issue => ({
    ...base().issue,
    id,
    titulo: "T",
    tipo: "problema",
    ...troca,
  });
  const concluida = { fase: "concluida" as const, concluidaEm: AGORA };
  const issues = [
    issue(1, concluida),
    issue(2, { fase: "aprovacao_pr" }),
    issue(3, { ...concluida, arquivadaEm: "2026-01-01T00:00:00.000Z" }),
    issue(4, concluida),
  ];
  assert.deepEqual(
    arquivarConcluidas(issues, auditor, contexto()).map((i) => [i.id, i.arquivadaEm]),
    [
      [1, AGORA],
      [4, AGORA],
    ],
  );
  escopo(
    () => arquivarConcluidas(issues, agente(34), contexto()),
    "só o Auditor pode arquivar issues (peça ao Auditor pelo web)",
  );
});

test("C22 cancela a issue em qualquer fase menos concluída e mantém a fase", () => {
  for (const fase of ["registro", "desenho", "desenvolvimento", "revisao", "aprovacao_pr", "ajuste_pr"] as const) {
    const depois = cancelarIssue(base({ fase }), auditor, contexto());
    assert.equal(depois.issue.canceladaEm, AGORA, fase);
    assert.equal(depois.issue.fase, fase);
  }
});

test("C22 fecha os tickets abertos e falhos sem erro, cancela o em execução e termina a execução em andamento", () => {
  const ag = base();
  const molde = ag.tickets[1] ?? assert.fail("ticket 35 ausente");
  const falho: Ticket = { ...molde, id: 36, status: "falhou", erro: "caiu" };
  const feito: Ticket = { ...molde, id: 37, status: "concluido", concluidoEm: AGORA };
  const depois = cancelarIssue({ ...ag, tickets: [...ag.tickets, falho, feito] }, auditor, contexto());

  assert.deepEqual(
    depois.tickets.map((t) => [t.id, t.status, t.erro]),
    [
      [34, "cancelado", undefined],
      [35, "fechado", undefined],
      [36, "fechado", undefined],
      [37, "concluido", undefined],
    ],
  );
  assert.deepEqual(depois.execucoes, [
    ag.execucoes[0],
    { ...execucao(7, "interativo"), resultado: "falha", erro: CANCELADA, terminadaEm: AGORA },
  ]);
  assert.equal(CANCELADA, "issue cancelada pelo Auditor");
});

test("C22 é só do Auditor e recusa issue concluída e já cancelada", () => {
  escopo(
    () => cancelarIssue(base(), agente(34), contexto()),
    "só o Auditor pode cancelar a I-1 (peça ao Auditor pelo web)",
  );
  escopo(
    () => cancelarIssue(base(), fabriquinha, contexto()),
    "só o Auditor pode cancelar a I-1 (peça ao Auditor pelo web)",
  );
  regra(
    () => cancelarIssue(base({ fase: "concluida", concluidaEm: AGORA }), auditor, contexto()),
    "a I-1 está concluída e não pode ser cancelada (ela já terminou o processo)",
  );
  regra(
    () => cancelarIssue(base({ canceladaEm: AGORA }), auditor, contexto()),
    "a I-1 já está cancelada (não há mais nada a fazer)",
  );
});

test("exigirNaoCancelada recusa a issue cancelada", () => {
  exigirNaoCancelada(base());
  regra(() => {
    exigirNaoCancelada(base({ canceladaEm: AGORA }));
  }, "a I-1 está cancelada e não muda mais (registre uma nova issue se precisar)");
});

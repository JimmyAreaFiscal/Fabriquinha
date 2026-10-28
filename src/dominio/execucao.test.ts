import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import type { Agregado, Ator, Contexto, Decisao, Execucao, ModoExecucao, Ticket } from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import {
  definirModeloTicket,
  devolverTicket,
  falharTicket,
  iniciarConsulta,
  iniciarExecucao,
  modeloDaExecucao,
  reabrirTicket,
  terminarExecucao,
} from "./execucao.ts";
import type { Etapa, Fase, Modelo } from "./primitivos.ts";
import type { Projeto } from "./projeto.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const ANTES = "2026-10-11T11:00:00.000Z";
const SESSAO = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OUTRA = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };
const agente: Ator = { tipo: "agente", execucao: 1, ticket: 1 };
const LOCAL: Modelo = { provedor: "llamacpp", modelo: "qwen" };
const CARO: Modelo = { provedor: "openai", modelo: "gpt-5" };

const projeto: Projeto = {
  nome: "loja",
  repo: "/r",
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  testes: ["t"],
  sonar: { projectKey: "k" },
  fitness: [{ nome: "f", comando: "c", descricao: "d" }],
  modelos: { desenvolvimento: LOCAL },
};

/** Contexto falso: o projeto `loja`, IDs a partir de 41, e os fatos do C5 que o teste quiser. */
function contexto(fatos: { depsConcluidas?: boolean } = {}): Contexto {
  const ids: Record<string, number> = {};
  return {
    agora: AGORA,
    novoId: (tipo) => (ids[tipo] = (ids[tipo] ?? 40) + 1),
    projeto: (nome) => (nome === "loja" ? projeto : undefined),
    issueExiste: () => true,
    alcancaveis: () => [],
    depsConcluidas: () => fatos.depsConcluidas ?? true,
    temCommit: () => false,
  };
}

const ticket = (id: number, etapa: Etapa, status: Ticket["status"], troca: Partial<Ticket> = {}): Ticket => ({
  id,
  issue: 1,
  etapa,
  titulo: `Ticket ${String(id)}`,
  descricao: "",
  status,
  origem: "fabriquinha",
  criadoEm: ANTES,
  ...troca,
});

const execucao = (id: number, de: number, modo: ModoExecucao, troca: Partial<Execucao> = {}): Execucao => ({
  id,
  ticket: de,
  modo,
  sessaoPi: SESSAO,
  resultado: "em_andamento",
  iniciadaEm: ANTES,
  ...troca,
});

const terminada = (id: number, de: number, modo: ModoExecucao = "autonomo"): Execucao =>
  execucao(id, de, modo, { resultado: "sucesso", terminadaEm: ANTES });

/** I-1 do projeto `loja` na `fase`, com os tickets e as execuções dados. */
const agregado = (fase: Fase, tickets: Ticket[], execucoes: Execucao[] = []): Agregado => ({
  issue: {
    id: 1,
    projeto: "loja",
    titulo: "T",
    tipo: "problema",
    descricao: "",
    fase,
    deps: [],
    criadaEm: ANTES,
    ...(fase === "concluida" && { concluidaEm: ANTES }),
  },
  tickets,
  execucoes,
  decisoes: [],
  evidencias: [],
});

const regra = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeRegra && e.message === mensagem);
};
const escopo = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeEscopo && e.message === mensagem);
};

test("modeloDaExecucao: override do ticket, senão o modelo da etapa no projeto, senão o padrão do pi", () => {
  const dev = ticket(1, "desenvolvimento", "aberto");
  assert.deepEqual(modeloDaExecucao({ ...dev, modelo: CARO }, projeto), CARO);
  assert.deepEqual(modeloDaExecucao(dev, projeto), LOCAL);
  assert.equal(modeloDaExecucao(ticket(2, "desenho", "aberto"), projeto), undefined);
  assert.equal(modeloDaExecucao(dev, undefined), undefined);
});

test("C5 autônomo: ticket em execução, execução nova com o modelo resolvido, instrução consumida", () => {
  const dev = ticket(2, "desenvolvimento", "aberto", { instrucao: "rode os testes antes" });
  const ag = agregado(
    "desenvolvimento",
    [ticket(1, "desenho", "concluido", { concluidoEm: ANTES }), dev],
    [terminada(5, 1)],
  );
  const inicio = { ticket: 2, modo: "autonomo", sessaoPi: SESSAO };

  assert.deepEqual(iniciarExecucao(ag, inicio, fabriquinha, contexto()), {
    ...ag,
    tickets: [ag.tickets[0], ticket(2, "desenvolvimento", "em_execucao")],
    execucoes: [
      ...ag.execucoes,
      {
        id: 41,
        ticket: 2,
        modo: "autonomo",
        sessaoPi: SESSAO,
        modelo: LOCAL,
        resultado: "em_andamento",
        iniciadaEm: AGORA,
      },
    ],
  });
  const comOverride = agregado("desenvolvimento", [{ ...dev, modelo: CARO }]);
  assert.deepEqual(iniciarExecucao(comOverride, inicio, fabriquinha, contexto()).execucoes[0]?.modelo, CARO);
  const revisao = agregado("revisao", [ticket(3, "revisao", "aberto")]);
  const semModelo = iniciarExecucao(revisao, { ...inicio, ticket: 3 }, fabriquinha, contexto()).execucoes[0];
  assert.ok(semModelo && !("modelo" in semModelo));
});

test("C5 autônomo exige ticket aberto e dependências concluídas", () => {
  const inicio = { ticket: 2, modo: "autonomo", sessaoPi: SESSAO };
  const com = (status: Ticket["status"], troca: Partial<Ticket> = {}) =>
    agregado("desenvolvimento", [ticket(2, "desenvolvimento", status, troca)]);
  regra(
    () => iniciarExecucao(com("em_execucao"), inicio, fabriquinha, contexto()),
    "T-2 está em_execucao e não pode executar (reabra-o se ele falhou)",
  );
  regra(
    () => iniciarExecucao(com("falhou", { erro: "e" }), inicio, fabriquinha, contexto()),
    "T-2 está falhou e não pode executar (reabra-o se ele falhou)",
  );
  regra(
    () => iniciarExecucao(com("concluido", { concluidoEm: ANTES }), inicio, fabriquinha, contexto()),
    "T-2 está concluido e não pode executar (reabra-o se ele falhou)",
  );
  regra(
    () => iniciarExecucao(com("aberto"), inicio, fabriquinha, contexto({ depsConcluidas: false })),
    "a I-1 depende de issues ainda não concluídas (conclua as dependências antes)",
  );
});

test("C5 do desenvolvimento espera os tickets de desenvolvimento anteriores da issue concluírem", () => {
  const ag = agregado("desenvolvimento", [
    ticket(2, "desenvolvimento", "falhou", { erro: "e" }),
    ticket(3, "desenvolvimento", "aberto"),
  ]);
  regra(
    () => iniciarExecucao(ag, { ticket: 3, modo: "autonomo", sessaoPi: SESSAO }, fabriquinha, contexto()),
    "T-3 só executa depois dos tickets de desenvolvimento anteriores da I-1, e T-2 está falhou (conclua T-2 antes)",
  );
});

test("C5 autônomo não recusa por autônoma de outra issue, mas recusa a 2ª da mesma issue e não cria execução (CA-6)", () => {
  const inicio = { ticket: 2, modo: "autonomo", sessaoPi: SESSAO };
  const dev = (id: number) => ticket(id, "desenvolvimento", "aberto");
  const ag = agregado("desenvolvimento", [dev(2), dev(3)]);
  const rodando = iniciarExecucao(ag, inicio, fabriquinha, contexto());
  assert.equal(rodando.execucoes.length, 1);
  assert.equal(rodando.tickets[0]?.status, "em_execucao");
  const mesma = { ...ag, execucoes: [execucao(9, 3, "autonomo")] };
  regra(
    () => iniciarExecucao(mesma, inicio, fabriquinha, contexto()),
    "a I-1 já tem a execução E-9 em andamento (espere ela terminar)",
  );
  assert.equal(mesma.execucoes.length, 1);
});

test("C5 interativo aceita ticket aberto ou em execução; só o desenho que começa exige as dependências", () => {
  const fatos = contexto({ depsConcluidas: false });
  const registro = agregado("registro", [ticket(1, "registro", "em_execucao")], [terminada(5, 1, "interativo")]);
  const retomado = iniciarExecucao(registro, { ticket: 1, modo: "interativo", sessaoPi: SESSAO }, fabriquinha, fatos);
  assert.equal(retomado.tickets[0]?.status, "em_execucao");
  assert.deepEqual(
    retomado.execucoes.map((e) => [e.id, e.modo, e.resultado]),
    [
      [5, "interativo", "sucesso"],
      [41, "interativo", "em_andamento"],
    ],
  );
  const sessao = agregado("ajuste_pr", [ticket(4, "sessao", "aberto")]);
  const aberta = iniciarExecucao(sessao, { ticket: 4, modo: "interativo", sessaoPi: SESSAO }, fabriquinha, fatos);
  assert.equal(aberta.tickets[0]?.status, "em_execucao");
  regra(
    () =>
      iniciarExecucao(
        agregado("registro", [ticket(1, "registro", "concluido", { concluidoEm: ANTES })]),
        { ticket: 1, modo: "interativo", sessaoPi: SESSAO },
        fabriquinha,
        fatos,
      ),
    "T-1 está concluido e não pode executar (reabra-o se ele falhou)",
  );
  const desenho = (status: Ticket["status"]) => agregado("desenho", [ticket(2, "desenho", status)]);
  const inicio = { ticket: 2, modo: "interativo", sessaoPi: SESSAO };
  regra(
    () => iniciarExecucao(desenho("aberto"), inicio, fabriquinha, fatos),
    "a I-1 depende de issues ainda não concluídas (conclua as dependências antes)",
  );
  assert.equal(iniciarExecucao(desenho("aberto"), inicio, fabriquinha, contexto()).tickets[0]?.status, "em_execucao");
  const conversa = iniciarExecucao(desenho("em_execucao"), inicio, fabriquinha, fatos);
  assert.equal(conversa.execucoes[0]?.modo, "interativo");
});

test("C5 confere modo × etapa, fase × etapa e execução em andamento na issue", () => {
  const ag = agregado("desenho", [
    ticket(1, "registro", "concluido", { concluidoEm: ANTES }),
    ticket(2, "desenho", "aberto"),
  ]);
  const iniciar =
    (entrada: object, alvo = ag) =>
    () =>
      iniciarExecucao(alvo, entrada, fabriquinha, contexto());
  regra(
    iniciar({ ticket: 2, modo: "autonomo", sessaoPi: SESSAO }),
    "T-2 é da etapa desenho, que roda em modo interativo (inicie em modo interativo)",
  );
  regra(
    iniciar({ ticket: 2, modo: "consulta", sessaoPi: SESSAO }),
    "T-2 é da etapa desenho, que roda em modo interativo (inicie em modo interativo)",
  );
  regra(
    iniciar({ ticket: 1, modo: "autonomo", sessaoPi: SESSAO }),
    "T-1 é da etapa registro, que roda em modo interativo (inicie em modo interativo)",
  );
  regra(
    iniciar(
      { ticket: 2, modo: "interativo", sessaoPi: SESSAO },
      { ...ag, issue: { ...ag.issue, fase: "aprovacao_desenho" } },
    ),
    "T-2 só executa na fase desenho, e a I-1 está em aprovacao_desenho (espere a issue chegar a essa fase)",
  );
  regra(
    iniciar({ ticket: 1, modo: "interativo", sessaoPi: SESSAO }),
    "T-1 só executa na fase registro, e a I-1 está em desenho (espere a issue chegar a essa fase)",
  );
  // Uma consulta sobre outro ticket da issue também segura a issue.
  regra(
    iniciar({ ticket: 2, modo: "interativo", sessaoPi: SESSAO }, { ...ag, execucoes: [execucao(9, 1, "consulta")] }),
    "a I-1 já tem a execução E-9 em andamento (espere ela terminar)",
  );
  regra(
    iniciar({ ticket: 7, modo: "autonomo", sessaoPi: SESSAO }),
    "o ticket T-7 não é da I-1 (confira o número do ticket)",
  );
  assert.throws(iniciar({ ticket: 2, modo: "autonomo", sessaoPi: "abc" }), ZodError);
  assert.throws(iniciar({ ticket: 2, modo: "paralelo", sessaoPi: SESSAO }), ZodError);
});

test("C5, C6 e C8 são só da Fabriquinha; C9, C20 e C21 só do Auditor", () => {
  const ag = agregado("desenho", [ticket(1, "desenho", "aberto")]);
  for (const ator of [auditor, agente]) {
    escopo(
      () => iniciarExecucao(ag, {}, ator, contexto()),
      "só a Fabriquinha pode iniciar uma execução (ela faz isso sozinha ao executar o ticket)",
    );
    escopo(
      () => terminarExecucao(ag, {}, ator, contexto()),
      "só a Fabriquinha pode terminar uma execução (ela faz isso sozinha ao executar o ticket)",
    );
    escopo(
      () => falharTicket(ag, {}, ator),
      "só a Fabriquinha pode falhar um ticket (ela faz isso sozinha ao executar o ticket)",
    );
    escopo(
      () => devolverTicket(ag, {}, ator),
      "só a Fabriquinha pode devolver um ticket (ela faz isso sozinha ao executar o ticket)",
    );
  }
  for (const ator of [fabriquinha, agente]) {
    escopo(() => reabrirTicket(ag, {}, ator), "só o Auditor pode reabrir um ticket (peça ao Auditor pelo web)");
    escopo(
      () => definirModeloTicket(ag, {}, ator),
      "só o Auditor pode trocar o modelo de um ticket (peça ao Auditor pelo web)",
    );
    escopo(
      () => iniciarConsulta(ag, {}, ator, contexto()),
      "só o Auditor pode abrir uma consulta (peça ao Auditor pelo web)",
    );
  }
});

test("C6 grava resultado e término sem mudar o ticket", () => {
  const ag = agregado("desenho", [ticket(1, "desenho", "em_execucao")], [terminada(5, 1), execucao(6, 1, "autonomo")]);
  const terminar = (entrada: object) => terminarExecucao(ag, entrada, fabriquinha, contexto());

  const sucesso = terminar({ execucao: 6, resultado: "sucesso" });
  assert.deepEqual(sucesso, {
    ...ag,
    execucoes: [ag.execucoes[0], { ...execucao(6, 1, "autonomo"), resultado: "sucesso", terminadaEm: AGORA }],
  });
  assert.deepEqual(terminar({ execucao: 6, resultado: "falha", erro: " pi saiu com 1 " }).execucoes[1], {
    ...execucao(6, 1, "autonomo"),
    resultado: "falha",
    erro: "pi saiu com 1",
    terminadaEm: AGORA,
  });
  regra(() => terminar({ execucao: 5, resultado: "sucesso" }), "a execução E-5 já terminou com sucesso (nada a fazer)");
  regra(
    () => terminar({ execucao: 9, resultado: "sucesso" }),
    "a execução E-9 não é da I-1 (confira o número da execução)",
  );
  assert.throws(() => terminar({ execucao: 6, resultado: "falha" }), ZodError);
  assert.throws(() => terminar({ execucao: 6, resultado: "falha", erro: " " }), ZodError);
  assert.throws(() => terminar({ execucao: 6, resultado: "em_andamento" }), ZodError);
});

test("C8 falha o ticket e remove os tickets de desenvolvimento abertos que ele criou e a decisão de revisão dele", () => {
  const filho = (id: number, status: Ticket["status"], troca: Partial<Ticket> = {}) =>
    ticket(id, "desenvolvimento", status, { origem: "agente", origemTicket: 1, ...troca });
  const revisao = ticket(1, "revisao", "em_execucao");
  let ag = agregado(
    "revisao",
    [
      revisao,
      filho(2, "aberto"),
      filho(3, "concluido", { concluidoEm: ANTES }),
      filho(4, "aberto", { origemTicket: 9 }),
      ticket(5, "desenvolvimento", "aberto", { origem: "auditor" }),
      filho(6, "aberto"),
    ],
    [terminada(7, 1)],
  );
  const decisao = (id: number, de: number, gate: Decisao["gate"]): Decisao => ({
    id,
    issue: 1,
    ticket: de,
    gate,
    aprovado: true,
    por: gate === "revisao" ? "agente" : "auditor",
    em: ANTES,
  });
  ag = { ...ag, decisoes: [decisao(1, 9, "desenho"), decisao(2, 1, "revisao"), decisao(3, 8, "revisao")] };
  const falhou = falharTicket(ag, { ticket: 1, erro: "tempo limite de 120 min" }, fabriquinha);
  assert.deepEqual(falhou, {
    ...ag,
    decisoes: [decisao(1, 9, "desenho"), decisao(3, 8, "revisao")],
    tickets: [
      { ...revisao, status: "falhou", erro: "tempo limite de 120 min" },
      ...ag.tickets.filter((t) => [3, 4, 5].includes(t.id)),
    ],
  });
  assert.throws(() => falharTicket(ag, { ticket: 1, erro: "" }, fabriquinha), ZodError);
});

test("C8 exige ticket autônomo em execução e sem execução em andamento", () => {
  const falhar =
    (ag: Agregado, id = 1) =>
    () =>
      falharTicket(ag, { ticket: id, erro: "e" }, fabriquinha);
  regra(
    falhar(agregado("registro", [ticket(1, "registro", "em_execucao")])),
    "T-1 é interativo e não falha (a sessão continua em execução e o Auditor a retoma)",
  );
  regra(
    falhar(agregado("ajuste_pr", [ticket(1, "sessao", "em_execucao")])),
    "T-1 é interativo e não falha (a sessão continua em execução e o Auditor a retoma)",
  );
  regra(
    falhar(agregado("desenho", [ticket(1, "desenho", "em_execucao")])),
    "T-1 é interativo e não falha (a sessão continua em execução e o Auditor a retoma)",
  );
  regra(
    falhar(agregado("revisao", [ticket(1, "revisao", "aberto")])),
    "T-1 está aberto, não em execução (só falha o ticket em execução)",
  );
  regra(
    falhar(agregado("revisao", [ticket(1, "revisao", "em_execucao")], [execucao(3, 1, "autonomo")])),
    "T-1 não pode falhar: a execução E-3 ainda está em andamento (espere ela terminar)",
  );
  regra(falhar(agregado("desenho", []), 4), "o ticket T-4 não é da I-1 (confira o número do ticket)");
});

test("devolverTicket volta o ticket autônomo em execução a aberto com a instrução", () => {
  const dev = ticket(1, "desenvolvimento", "em_execucao");
  const ag = agregado("desenvolvimento", [dev], [terminada(7, 1)]);
  assert.deepEqual(devolverTicket(ag, { ticket: 1, instrucao: "corrija" }, fabriquinha), {
    ...ag,
    tickets: [{ ...dev, status: "aberto", instrucao: "corrija", devolucoes: 1 }],
  });
  const devolvido = devolverTicket(
    agregado("desenvolvimento", [{ ...dev, devolucoes: 1 }]),
    { ticket: 1, instrucao: "de novo" },
    fabriquinha,
  );
  assert.equal(devolvido.tickets[0]?.devolucoes, 2);
  const devolver = (a: Agregado) => () => devolverTicket(a, { ticket: 1, instrucao: "x" }, fabriquinha);
  regra(
    devolver(agregado("desenho", [ticket(1, "desenho", "em_execucao")])),
    "T-1 está em_execucao (só se devolve ticket autônomo em execução)",
  );
  regra(
    devolver(agregado("desenvolvimento", [ticket(1, "desenvolvimento", "aberto")])),
    "T-1 está aberto (só se devolve ticket autônomo em execução)",
  );
  regra(
    devolver(agregado("desenvolvimento", [dev], [execucao(3, 1, "autonomo")])),
    "T-1 não pode devolver: a execução E-3 ainda está em andamento (espere ela terminar)",
  );
});

test("C9 reabre ticket falho, apaga o erro e grava a instrução quando informada", () => {
  const falho = ticket(1, "desenho", "falhou", { erro: "testes reprovados", devolucoes: 2 });
  const ag = agregado("desenho", [falho]);
  assert.deepEqual(reabrirTicket(ag, { ticket: 1, instrucao: "use a lib X" }, auditor).tickets, [
    ticket(1, "desenho", "aberto", { instrucao: "use a lib X" }),
  ]);
  assert.deepEqual(reabrirTicket(ag, { ticket: 1 }, auditor).tickets, [ticket(1, "desenho", "aberto")]);
  regra(
    () => reabrirTicket(agregado("desenho", [ticket(1, "desenho", "em_execucao")]), { ticket: 1 }, auditor),
    "T-1 está em_execucao (só se reabre ticket que falhou)",
  );
  assert.throws(() => reabrirTicket(ag, { ticket: 1, instrucao: "p ".repeat(1001) }, auditor), ZodError);
});

test("C20 define ou remove o override de modelo de ticket não concluído e parado", () => {
  const ag = agregado("desenvolvimento", [ticket(1, "desenvolvimento", "aberto", { modelo: LOCAL })]);
  assert.deepEqual(definirModeloTicket(ag, { ticket: 1, modelo: CARO }, auditor).tickets, [
    ticket(1, "desenvolvimento", "aberto", { modelo: CARO }),
  ]);
  assert.deepEqual(definirModeloTicket(ag, { ticket: 1, modelo: null }, auditor).tickets, [
    ticket(1, "desenvolvimento", "aberto"),
  ]);
  regra(
    () =>
      definirModeloTicket(
        agregado("revisao", [ticket(1, "desenvolvimento", "concluido", { concluidoEm: ANTES })]),
        { ticket: 1, modelo: null },
        auditor,
      ),
    "T-1 já está concluído (o modelo só vale para as próximas execuções)",
  );
  regra(
    () =>
      definirModeloTicket(
        agregado("desenvolvimento", [ticket(1, "desenvolvimento", "em_execucao")], [execucao(2, 1, "autonomo")]),
        { ticket: 1, modelo: null },
        auditor,
      ),
    "T-1 não pode trocar de modelo: a execução E-2 ainda está em andamento (espere ela terminar)",
  );
  assert.throws(() => definirModeloTicket(ag, { ticket: 1 }, auditor), ZodError);
});

test("C21 abre consulta numa sessão nova, sem mudar o ticket, mesmo com issue concluída", () => {
  const dev = ticket(1, "desenvolvimento", "concluido", { concluidoEm: ANTES });
  const ag = agregado("concluida", [dev], [terminada(5, 1), terminada(6, 1, "consulta")]);
  const depois = iniciarConsulta(ag, { ticket: 1, sessaoPi: OUTRA }, auditor, contexto());
  assert.deepEqual(depois, {
    ...ag,
    execucoes: [
      ...ag.execucoes,
      {
        id: 41,
        ticket: 1,
        modo: "consulta",
        sessaoPi: OUTRA,
        modelo: LOCAL,
        resultado: "em_andamento",
        iniciadaEm: AGORA,
      },
    ],
  });
});

test("C21 exige sessão principal, nenhuma execução do ticket em andamento e uma sessão diferente", () => {
  const dev = ticket(1, "desenvolvimento", "em_execucao");
  const consultar =
    (execucoes: Execucao[], sessaoPi = OUTRA) =>
    () =>
      iniciarConsulta(agregado("desenvolvimento", [dev], execucoes), { ticket: 1, sessaoPi }, auditor, contexto());
  const semSessao = "T-1 ainda não tem sessão (consulte um ticket que já executou)";
  regra(consultar([]), semSessao);
  regra(consultar([terminada(6, 1, "consulta")]), semSessao);
  regra(
    consultar([execucao(5, 1, "autonomo")]),
    "T-1 não pode abrir uma consulta: a execução E-5 ainda está em andamento (espere ela terminar)",
  );
  regra(
    consultar([terminada(5, 1)], SESSAO),
    "a consulta não pode usar a sessão principal de T-1 (copie a sessão antes)",
  );
  assert.throws(consultar([terminada(5, 1)], "x"), ZodError);
});

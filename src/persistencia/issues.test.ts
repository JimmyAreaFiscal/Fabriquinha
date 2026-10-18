import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { ZodError } from "zod";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { type Agregado, type Ator, CANCELADA, type Ticket } from "../dominio/agregado.ts";
import { ErroDeEscopo, ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import {
  definirModeloTicket,
  falharTicket,
  iniciarConsulta,
  iniciarExecucao,
  reabrirTicket,
  terminarExecucao,
} from "../dominio/execucao.ts";
import { registrarEvidencia } from "../dominio/evidencia.ts";
import { decidirDesenho, decidirRegistro, enviarParaAprovacao } from "../dominio/gates.ts";
import { adicionarDependencia, editarIssue, removerDependencia } from "../dominio/issue.ts";
import { adicionarTicketDesenvolvimento, editarTicket, removerTicket } from "../dominio/tickets.ts";
import { abrir } from "./banco.ts";
import {
  agregado,
  arquivarConcluidas,
  cancelarIssues,
  comIssue,
  decidirProposta,
  dependentes,
  fasesPercorridas,
  issuesEmAndamento,
  proporIssue,
  propostasDaIssue,
  registrarIssue,
  situacaoDasIssues,
} from "./issues.ts";
import { registrarProjeto } from "./projetos.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-issues-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };
const SESSAO = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const COPIA = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const INSTANTE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** Banco novo com os projetos `loja` e `outro`. */
function novoBanco(raiz = mkdtempSync(join(base, "raiz-"))): DatabaseSync {
  const banco = abrir(raiz);
  for (const nome of ["loja", "outro"]) {
    registrarProjeto(banco, {
      nome,
      repo: `/repos/${nome}`,
      branchBase: "main",
      hospedagem: "github",
      testes: ["npm test"],
      sonar: { projectKey: nome },
      fitness: [{ nome: "f", comando: "c", descricao: "d" }],
    });
  }
  return banco;
}

const todas = (banco: DatabaseSync, sql: string, ...params: (number | string)[]) => banco.prepare(sql).all(...params);
const valor = (banco: DatabaseSync, sql: string): unknown => Object.values(banco.prepare(sql).get() ?? {})[0];
const regra = (trabalho: () => unknown, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof ErroDeRegra && e.message === mensagem);
};

test("registrarIssue grava a issue, as deps e o ticket de registro; agregado() lê igual", () => {
  const banco = novoBanco();
  const dep = registrarIssue(banco, { projeto: "outro" }, auditor);
  const ag = registrarIssue(banco, { projeto: "loja", deps: [dep.issue.id] }, auditor);

  assert.deepEqual([dep.issue.id, dep.tickets[0]?.id, ag.issue.id, ag.tickets[0]?.id], [1, 1, 2, 2]);
  assert.match(ag.issue.criadaEm, INSTANTE);
  assert.deepEqual(ag.issue.deps, [1]);
  assert.deepEqual(
    ag.tickets.map((t) => [t.etapa, t.status, t.origem, t.titulo]),
    [["registro", "aberto", "fabriquinha", "Registrar a necessidade"]],
  );
  assert.deepEqual(agregado(banco, 2), ag);
  assert.equal(agregado(banco, 3), undefined);
  assert.equal(banco.isTransaction, false);
  banco.close();
});

test("registrarIssue recusa sem gravar nada", () => {
  const banco = novoBanco();
  regra(
    () => registrarIssue(banco, { projeto: "nenhum" }, auditor),
    "o projeto nenhum não existe (cadastre-o na Configuração)",
  );
  regra(
    () => registrarIssue(banco, { projeto: "loja", deps: [9] }, auditor),
    "a issue I-9 não existe (confira o número da issue)",
  );
  assert.throws(() => registrarIssue(banco, { projeto: "loja", deps: "1" }, auditor), ZodError);
  assert.throws(() => registrarIssue(banco, { projeto: "loja" }, { tipo: "fabriquinha" }), ErroDeEscopo);
  assert.equal(valor(banco, "SELECT count(*) FROM issue"), 0);
  assert.equal(valor(banco, "SELECT count(*) FROM sequencia"), 0);
  banco.close();
});

test("comIssue aplica C2, C3 e C4 e registra cada comando com o ator e a fase de antes", () => {
  const banco = novoBanco();
  const [a, b] = [
    registrarIssue(banco, { projeto: "loja" }, auditor),
    registrarIssue(banco, { projeto: "outro" }, auditor),
  ];
  const id = a.issue.id;
  comIssue(banco, id, "editarIssue", auditor, (ag) =>
    editarIssue(ag, { titulo: "Login lento", tipo: "problema" }, auditor),
  );
  comIssue(banco, id, "adicionarDependencia", auditor, (ag, ctx) => adicionarDependencia(ag, b.issue.id, auditor, ctx));
  comIssue(banco, id, "adicionarDependencia", auditor, (ag, ctx) => adicionarDependencia(ag, b.issue.id, auditor, ctx));
  const depois = comIssue(banco, id, "removerDependencia", auditor, (ag) =>
    removerDependencia(ag, b.issue.id, auditor),
  );

  assert.deepEqual(depois, { ...a, issue: { ...a.issue, titulo: "Login lento", tipo: "problema" } });
  assert.deepEqual(agregado(banco, id), depois);
  const comandos = todas(banco, "SELECT id, issue, nome, ator, fase, em FROM comando ORDER BY id");
  assert.deepEqual(
    comandos.map((c) => [c.issue, c.nome, c.ator, c.fase]),
    [
      [id, "editarIssue", "auditor", "registro"],
      [id, "adicionarDependencia", "auditor", "registro"],
      [id, "adicionarDependencia", "auditor", "registro"],
      [id, "removerDependencia", "auditor", "registro"],
    ],
  );
  assert.ok(comandos.every((c) => INSTANTE.test(String(c.em))));
  banco.close();
});

test("comIssue grava a fase de antes, não a de depois", () => {
  const banco = novoBanco();
  const { issue } = registrarIssue(banco, { projeto: "loja" }, auditor);
  comIssue(banco, issue.id, "editarIssue", auditor, (ag) => ({
    ...ag,
    issue: { ...ag.issue, titulo: "T", tipo: "funcionalidade", fase: "desenho" },
  }));
  comIssue(banco, issue.id, "adicionarDependencia", auditor, (ag) => ag);
  assert.deepEqual(
    todas(banco, "SELECT fase FROM comando ORDER BY id").map((c) => c.fase),
    ["registro", "desenho"],
  );
  // As fases percorridas, uma vez cada e na ordem em que a issue entrou nelas.
  comIssue(banco, issue.id, "removerDependencia", auditor, (ag) => ag);
  assert.deepEqual(fasesPercorridas(banco, issue.id), ["registro", "desenho"]);
  banco.close();
});

test("dependências: ciclo detectado pela CTE entre projetos, sem gravar nada", () => {
  const banco = novoBanco();
  const [i1, i2, i3] = ["loja", "outro", "loja"].map(
    (projeto) => registrarIssue(banco, { projeto }, auditor).issue.id,
  ) as [number, number, number];
  const depender = (issue: number, dep: number) =>
    comIssue(banco, issue, "adicionarDependencia", auditor, (ag, ctx) => adicionarDependencia(ag, dep, auditor, ctx));
  depender(i1, i2);
  depender(i2, i3);
  regra(
    () => depender(i3, i1),
    "a I-3 não pode depender da I-1: a I-1 já depende da I-3 e isso fecharia um ciclo (remova antes uma das dependências do ciclo)",
  );
  regra(() => depender(i3, i3), "a I-3 não pode depender de si mesma (informe outra issue)");
  regra(() => depender(i3, 99), "a issue I-99 não existe (confira o número da issue)");
  depender(i1, i3); // atalho no mesmo sentido não fecha ciclo
  assert.deepEqual(
    todas(banco, "SELECT issue, dep FROM issue_dep ORDER BY rowid").map((d) => [d.issue, d.dep]),
    [
      [i1, i2],
      [i2, i3],
      [i1, i3],
    ],
  );
  assert.equal(valor(banco, "SELECT count(*) FROM comando"), 3);
  banco.close();
});

test("comIssue recusa issue inexistente e desfaz tudo quando o comando falha", () => {
  const banco = novoBanco();
  regra(
    () => comIssue(banco, 5, "editarIssue", auditor, (ag) => ag),
    "a issue I-5 não existe (confira o número da issue)",
  );
  const ag = registrarIssue(banco, { projeto: "loja" }, auditor);
  assert.throws(
    () =>
      comIssue(banco, 1, "editarIssue", auditor, (atual, ctx) => {
        ctx.novoId("ticket");
        return editarIssue(atual, { tipo: "bug" }, auditor);
      }),
    ZodError,
  );
  assert.deepEqual(agregado(banco, 1), ag);
  assert.equal(valor(banco, "SELECT count(*) FROM comando"), 0);
  assert.equal(valor(banco, "SELECT valor FROM sequencia WHERE nome = 'ticket'"), 1);
  banco.close();
});

test("comIssue: o agente age só enquanto a execução dele, lida do agregado, está em andamento", () => {
  const banco = novoBanco();
  const { issue, tickets } = registrarIssue(banco, { projeto: "loja" }, auditor);
  const ticket = tickets[0]?.id ?? 0;
  const { execucoes } = comIssue(banco, issue.id, "iniciarExecucao", fabriquinha, (ag, ctx) =>
    iniciarExecucao(ag, { ticket, modo: "interativo", sessaoPi: SESSAO }, fabriquinha, ctx),
  );
  const execucao = execucoes[0]?.id ?? 0;
  const editar = (agente: Ator) =>
    comIssue(banco, issue.id, "editarIssue", agente, (ag) => editarIssue(ag, { titulo: "T" }, agente));
  assert.equal(editar({ tipo: "agente", execucao, ticket }).issue.titulo, "T");
  comIssue(banco, issue.id, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
  );
  for (const id of [execucao, 7]) {
    assert.throws(
      () => editar({ tipo: "agente", execucao: id, ticket }),
      (e) =>
        e instanceof ErroDeEscopo &&
        e.message === `a execução E-${String(id)} já terminou (peça ao Auditor uma nova execução)`,
    );
  }
  banco.close();
});

test("comIssue grava só a diferença: insere, atualiza e apaga linha a linha", () => {
  const banco = novoBanco();
  registrarIssue(banco, { projeto: "outro" }, auditor);
  const { issue } = registrarIssue(banco, { projeto: "loja", deps: [1] }, auditor);
  const ticket = (id: number, troca: Partial<Ticket>): Ticket => ({
    id,
    issue: issue.id,
    etapa: "desenvolvimento",
    titulo: `Ticket ${String(id)}`,
    descricao: "",
    status: "aberto",
    origem: "auditor",
    criadoEm: "2026-10-11T12:00:00.000Z",
    ...troca,
  });
  const completo = ticket(11, {
    origem: "agente",
    origemTicket: 2,
    modelo: { provedor: "openai", modelo: "gpt-5" },
    instrucao: "tente de novo",
    descricao: "detalhes",
    status: "falhou",
    erro: "testes reprovados",
  });
  const concluido = ticket(12, { status: "concluido", concluidoEm: "2026-10-11T13:00:00.000Z" });
  const comNovos = comIssue(banco, issue.id, "editarIssue", auditor, (ag) => ({
    ...ag,
    tickets: [...ag.tickets, completo, concluido, ticket(13, {})],
  }));
  assert.deepEqual(agregado(banco, issue.id), comNovos);

  banco.exec(`
    CREATE TEMP TABLE escrita (op TEXT, tabela TEXT);
    CREATE TEMP TRIGGER t1 AFTER UPDATE ON ticket BEGIN INSERT INTO escrita VALUES ('update', 'ticket'); END;
    CREATE TEMP TRIGGER t2 AFTER DELETE ON ticket BEGIN INSERT INTO escrita VALUES ('delete', 'ticket'); END;
    CREATE TEMP TRIGGER t3 AFTER INSERT ON ticket BEGIN INSERT INTO escrita VALUES ('insert', 'ticket'); END;
    CREATE TEMP TRIGGER t4 AFTER UPDATE ON issue BEGIN INSERT INTO escrita VALUES ('update', 'issue'); END;
    CREATE TEMP TRIGGER t5 AFTER INSERT ON issue_dep BEGIN INSERT INTO escrita VALUES ('insert', 'issue_dep'); END;
    CREATE TEMP TRIGGER t6 AFTER DELETE ON issue_dep BEGIN INSERT INTO escrita VALUES ('delete', 'issue_dep'); END;
  `);
  const depois = comIssue(banco, issue.id, "editarIssue", auditor, (ag) => ({
    ...ag,
    issue: { ...ag.issue, descricao: "nova", deps: [] },
    tickets: ag.tickets
      .filter((t) => t.id !== 13)
      .map((t) => (t.id === 11 ? { ...t, modelo: undefined, instrucao: undefined } : t)),
  }));
  assert.deepEqual(agregado(banco, issue.id), JSON.parse(JSON.stringify(depois))); // sem as chaves undefined
  assert.deepEqual(
    todas(banco, "SELECT op, tabela FROM escrita ORDER BY rowid").map((e) => `${String(e.op)} ${String(e.tabela)}`),
    ["delete ticket", "delete issue_dep", "update issue", "update ticket"],
  );
  assert.deepEqual(
    todas(banco, "SELECT modelo_provedor, modelo_nome, instrucao FROM ticket WHERE id = 11").map((t) =>
      Object.values(t),
    ),
    [[null, null, null]],
  );
  banco.close();
});

test("arquivarConcluidas arquiva numa transação as concluídas do projeto e devolve quantas", () => {
  const banco = novoBanco();
  const concluir = (projeto: string) => {
    const { issue } = registrarIssue(banco, { projeto }, auditor);
    return comIssue(banco, issue.id, "editarIssue", auditor, (ag, ctx) => ({
      ...ag,
      issue: { ...ag.issue, titulo: "T", tipo: "problema", fase: "concluida", concluidaEm: ctx.agora },
    }));
  };
  const [a, b] = [concluir("loja"), concluir("loja")];
  const deOutro = concluir("outro");
  const emRegistro = registrarIssue(banco, { projeto: "loja" }, auditor);

  assert.throws(() => arquivarConcluidas(banco, "loja", { tipo: "fabriquinha" }), ErroDeEscopo);
  assert.equal(arquivarConcluidas(banco, "loja", auditor), 2);
  for (const ag of [a, b]) {
    const lido = agregado(banco, ag.issue.id);
    assert.ok(lido);
    assert.match(String(lido.issue.arquivadaEm), INSTANTE);
    assert.deepEqual(lido, { ...ag, issue: { ...ag.issue, arquivadaEm: lido.issue.arquivadaEm } });
  }
  assert.deepEqual(agregado(banco, deOutro.issue.id), deOutro);
  assert.deepEqual(agregado(banco, emRegistro.issue.id), emRegistro);
  assert.equal(arquivarConcluidas(banco, "loja", auditor), 0);
  assert.equal(arquivarConcluidas(banco, "nenhum", auditor), 0);
  banco.close();
});

/** Insere direto em SQL uma linha com as colunas trocadas; `null` em `troca` vira NULL. */
function inseridor(banco: DatabaseSync, tabela: string, padrao: Record<string, string | number>) {
  return (troca: Record<string, string | number | null> = {}) => {
    const linha = { ...padrao, ...troca };
    banco
      .prepare(
        `INSERT INTO ${tabela} (${Object.keys(linha).join(",")}) VALUES (${Object.keys(linha)
          .map(() => "?")
          .join(",")})`,
      )
      .run(...Object.values(linha));
  };
}

const violam = (
  inserir: (troca: Record<string, string | number | null>) => void,
  casos: [Record<string, string | number | null>, RegExp][],
) => {
  for (const [troca, erro] of casos) {
    assert.throws(
      () => {
        inserir(troca);
      },
      erro,
      JSON.stringify(troca),
    );
  }
};

test("as constraints da tabela issue valem no banco", () => {
  const banco = novoBanco();
  const issue = inseridor(banco, "issue", { projeto: "loja", fase: "registro", criada_em: "x" });
  const concluida = { fase: "concluida", titulo: "T", tipo: "problema", concluida_em: "x" };
  violam(issue, [
    [{ projeto: "nenhum" }, /FOREIGN KEY/],
    [{ titulo: "" }, /CHECK/],
    [{ titulo: "a".repeat(121) }, /CHECK/],
    [{ tipo: "bug" }, /CHECK/],
    [{ fase: "arquivada" }, /CHECK/],
    [{ fase: null }, /NOT NULL/],
    [{ descricao: null }, /NOT NULL/],
    [{ criada_em: null }, /NOT NULL/],
    [{ ...concluida, concluida_em: null }, /CHECK/],
    [{ concluida_em: "x" }, /CHECK/],
    [{ arquivada_em: "x" }, /CHECK/],
    [{ fase: "desenho", tipo: "problema" }, /CHECK/],
    [{ fase: "desenho", titulo: "T" }, /CHECK/],
  ]);
  issue({ id: 1 });
  issue({ ...concluida, arquivada_em: "x" });
  violam(issue, [[{ id: 1 }, /UNIQUE/]]);
  banco.close();
});

test("as constraints da tabela issue_dep valem no banco", () => {
  const banco = novoBanco();
  registrarIssue(banco, { projeto: "loja" }, auditor);
  registrarIssue(banco, { projeto: "loja" }, auditor);
  const dep = inseridor(banco, "issue_dep", { issue: 1, dep: 2 });
  violam(dep, [
    [{ dep: 9 }, /FOREIGN KEY/],
    [{ issue: 9 }, /FOREIGN KEY/],
    [{ dep: 1 }, /CHECK/],
    [{ dep: null }, /NOT NULL/],
  ]);
  dep();
  violam(dep, [[{}, /UNIQUE/]]);
  assert.throws(() => {
    banco.exec("DELETE FROM issue WHERE id = 2");
  }, /FOREIGN KEY/);
  banco.close();
});

test("as constraints da tabela ticket valem no banco", () => {
  const banco = novoBanco();
  registrarIssue(banco, { projeto: "loja" }, auditor); // I-1 com o ticket de registro T-1 aberto
  const ticket = inseridor(banco, "ticket", {
    issue: 1,
    etapa: "desenvolvimento",
    titulo: "T",
    status: "aberto",
    origem: "auditor",
    criado_em: "x",
  });
  violam(ticket, [
    [{ issue: 9 }, /FOREIGN KEY/],
    [{ etapa: "implementacao" }, /CHECK/],
    [{ titulo: "" }, /CHECK/],
    [{ titulo: "a".repeat(121) }, /CHECK/],
    [{ titulo: null }, /NOT NULL/],
    [{ status: "arquivado" }, /CHECK/],
    [{ origem: "humano" }, /CHECK/],
    [{ origem_ticket: 99 }, /FOREIGN KEY/],
    [{ status: "falhou" }, /CHECK/],
    [{ erro: "e" }, /CHECK/],
    [{ status: "concluido" }, /CHECK/],
    [{ concluido_em: "x" }, /CHECK/],
    [{ origem: "agente" }, /CHECK/],
    [{ modelo_provedor: "openai" }, /CHECK/],
    [{ modelo_nome: "gpt" }, /CHECK/],
    [{ criado_em: null }, /NOT NULL/],
    [{ descricao: null }, /NOT NULL/],
    // Invariante 2: segundo ticket de registro não concluído na mesma issue.
    [{ etapa: "registro" }, /UNIQUE constraint failed: ticket.issue, ticket.etapa/],
  ]);
  ticket({ status: "em_execucao" });
  // Invariante 1: segundo ticket em execução na mesma issue.
  violam(ticket, [[{ status: "em_execucao" }, /UNIQUE constraint failed: ticket.issue/]]);
  ticket({ origem: "agente", origem_ticket: 1, modelo_provedor: "openai", modelo_nome: "gpt" });
  ticket({ status: "falhou", erro: "e" });
  ticket({ etapa: "desenho", status: "concluido", concluido_em: "x" });
  ticket({ etapa: "desenho", status: "concluido", concluido_em: "x" });
  ticket({ etapa: "desenho" });
  assert.throws(() => {
    banco.exec("DELETE FROM ticket WHERE id = 1");
  }, /FOREIGN KEY/);
  banco.close();
});

test("as constraints da tabela comando valem no banco", () => {
  const banco = novoBanco();
  registrarIssue(banco, { projeto: "loja" }, auditor);
  const comando = inseridor(banco, "comando", {
    issue: 1,
    nome: "editarIssue",
    ator: "auditor",
    fase: "registro",
    em: "x",
  });
  violam(comando, [
    [{ issue: 9 }, /FOREIGN KEY/],
    [{ ator: "humano" }, /CHECK/],
    [{ fase: "arquivada" }, /CHECK/],
    [{ nome: null }, /NOT NULL/],
    [{ em: null }, /NOT NULL/],
  ]);
  comando();
  assert.equal(valor(banco, "SELECT count(*) FROM comando"), 1);
  banco.close();
});

/** Leva uma issue nova do `projeto` à fase `desenho`, com o ticket de desenho aberto; devolve a issue e o ticket. */
function emDesenho(
  banco: DatabaseSync,
  projeto = "loja",
  deps: number[] = [],
  etapa: "desenho" | "revisao" = "desenho",
): { issue: number; ticket: number } {
  const { issue } = registrarIssue(banco, { projeto, deps }, auditor);
  const ag = comIssue(banco, issue.id, "editarIssue", auditor, (atual, ctx) => ({
    ...atual,
    issue: { ...atual.issue, titulo: "T", tipo: "problema", fase: etapa },
    tickets: [
      ...atual.tickets.map((t) => ({ ...t, status: "concluido" as const, concluidoEm: ctx.agora })),
      { ...ticketBase(issue.id), id: ctx.novoId("ticket"), etapa, criadoEm: ctx.agora },
    ],
  }));
  return { issue: issue.id, ticket: ag.tickets[1]?.id ?? 0 };
}

/** A issue na revisão, com o ticket autônomo aberto: o desenho é interativo (F1 §3.6). */
const naRevisao = (banco: DatabaseSync, projeto = "loja", deps: number[] = []) =>
  emDesenho(banco, projeto, deps, "revisao");

const ticketBase = (issue: number): Ticket => ({
  id: 0,
  issue,
  etapa: "desenvolvimento",
  titulo: "Ticket",
  descricao: "",
  status: "aberto",
  origem: "fabriquinha",
  criadoEm: "x",
});

const iniciar = (banco: DatabaseSync, issue: number, ticket: number, modo = "autonomo") =>
  comIssue(banco, issue, "iniciarExecucao", fabriquinha, (ag, ctx) =>
    iniciarExecucao(ag, { ticket, modo, sessaoPi: SESSAO }, fabriquinha, ctx),
  );

const terminar = (banco: DatabaseSync, issue: number, execucao: number) =>
  comIssue(banco, issue, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao, resultado: "falha", erro: "pi saiu com 1" }, fabriquinha, ctx),
  );

test("ciclo de um ticket autônomo pelo comIssue: C5, C6, C8, C9, C20, C5 de novo e C21", () => {
  const banco = novoBanco();
  banco.exec(`UPDATE projeto SET modelos = '{"revisao":{"provedor":"llamacpp","modelo":"qwen"}}' WHERE nome = 'loja'`);
  const { issue, ticket } = naRevisao(banco);
  const execucao = iniciar(banco, issue, ticket).execucoes[0]?.id ?? 0;
  // O agente da revisão cria um ticket de desenvolvimento, que some quando a revisão falha (C8).
  comIssue(banco, issue, "editarIssue", auditor, (ag, ctx) => ({
    ...ag,
    tickets: [
      ...ag.tickets,
      { ...ticketBase(issue), id: ctx.novoId("ticket"), origem: "agente", origemTicket: ticket, criadoEm: ctx.agora },
    ],
  }));
  terminar(banco, issue, execucao);
  comIssue(banco, issue, "falharTicket", fabriquinha, (ag) =>
    falharTicket(ag, { ticket, erro: "faltou a comprovação dos critérios" }, fabriquinha),
  );
  comIssue(banco, issue, "reabrirTicket", auditor, (ag) =>
    reabrirTicket(ag, { ticket, instrucao: "comprove os critérios" }, auditor),
  );
  comIssue(banco, issue, "definirModeloTicket", auditor, (ag) =>
    definirModeloTicket(ag, { ticket, modelo: { provedor: "openai", modelo: "gpt-5" } }, auditor),
  );
  const reaberto = agregado(banco, issue);
  assert.deepEqual(
    reaberto?.tickets.map((t) => [t.id, t.status, t.erro, t.instrucao, t.modelo?.modelo]),
    [
      [1, "concluido", undefined, undefined, undefined],
      [ticket, "aberto", undefined, "comprove os critérios", "gpt-5"],
    ],
  );

  const segunda = iniciar(banco, issue, ticket);
  assert.deepEqual(agregado(banco, issue), segunda);
  assert.equal(segunda.tickets[1]?.instrucao, undefined);
  comIssue(banco, issue, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao: segunda.execucoes[1]?.id, resultado: "sucesso" }, fabriquinha, ctx),
  );
  const final = comIssue(banco, issue, "iniciarConsulta", auditor, (ag, ctx) =>
    iniciarConsulta(ag, { ticket, sessaoPi: COPIA }, auditor, ctx),
  );
  assert.deepEqual(agregado(banco, issue), final);
  assert.deepEqual(
    final.execucoes.map((e) => [e.id, e.modo, e.sessaoPi, e.modelo?.modelo, e.resultado, e.erro]),
    [
      [1, "autonomo", SESSAO, "qwen", "falha", "pi saiu com 1"],
      [2, "autonomo", SESSAO, "gpt-5", "sucesso", undefined],
      [3, "consulta", COPIA, "gpt-5", "em_andamento", undefined],
    ],
  );
  assert.ok(final.execucoes.every((e) => INSTANTE.test(e.iniciadaEm)));
  assert.deepEqual(
    todas(banco, "SELECT nome, ator FROM comando WHERE nome <> 'editarIssue' ORDER BY id").map(
      (c) => `${String(c.nome)} ${String(c.ator)}`,
    ),
    [
      "iniciarExecucao fabriquinha",
      "terminarExecucao fabriquinha",
      "falharTicket fabriquinha",
      "reabrirTicket auditor",
      "definirModeloTicket auditor",
      "iniciarExecucao fabriquinha",
      "terminarExecucao fabriquinha",
      "iniciarConsulta auditor",
    ],
  );
  banco.close();
});

test("C5 lê do banco as dependências concluídas e aceita autônoma com outra issue rodando", () => {
  const banco = novoBanco();
  const dep = naRevisao(banco, "outro");
  const { issue, ticket } = naRevisao(banco, "loja", [dep.issue]);
  regra(
    () => iniciar(banco, issue, ticket),
    "a I-2 depende de issues ainda não concluídas (conclua as dependências antes)",
  );
  banco.exec(`UPDATE issue SET fase = 'concluida', concluida_em = 'x' WHERE id = ${String(dep.issue)}`);
  const outra = naRevisao(banco, "outro");
  iniciar(banco, outra.issue, outra.ticket);
  assert.equal(iniciar(banco, issue, ticket).execucoes[0]?.modo, "autonomo");
  assert.equal(valor(banco, "SELECT count(*) FROM execucao WHERE resultado = 'em_andamento'"), 2);
  banco.close();
});

test("o diff apaga a execução antes do ticket (FK RESTRICT) e não toca em pgid_pi", () => {
  const banco = novoBanco();
  const { issue, ticket } = naRevisao(banco);
  iniciar(banco, issue, ticket);
  banco.exec("UPDATE execucao SET pgid_pi = 4242");
  terminar(banco, issue, 1);
  assert.equal(valor(banco, "SELECT pgid_pi FROM execucao"), 4242);

  const semTicket = (ag: Agregado): Agregado => ({
    ...ag,
    tickets: ag.tickets.filter((t) => t.id !== ticket),
    execucoes: [],
  });
  comIssue(banco, issue, "editarIssue", auditor, semTicket);
  assert.deepEqual(
    agregado(banco, issue)?.tickets.map((t) => t.id),
    [1],
  );
  assert.equal(valor(banco, "SELECT count(*) FROM execucao"), 0);
  banco.close();
});

test("as constraints da tabela execucao valem no banco", () => {
  const banco = novoBanco();
  const a = emDesenho(banco);
  const b = emDesenho(banco);
  const execucao = inseridor(banco, "execucao", {
    ticket: a.ticket,
    modo: "autonomo",
    sessao_pi: SESSAO,
    resultado: "sucesso",
    iniciada_em: "x",
    terminada_em: "x",
  });
  violam(execucao, [
    [{ ticket: 99 }, /FOREIGN KEY/],
    [{ modo: "paralelo" }, /CHECK/],
    [{ resultado: "cancelada" }, /CHECK/],
    [{ sessao_pi: null }, /NOT NULL/],
    [{ iniciada_em: null }, /NOT NULL/],
    [{ terminada_em: null }, /CHECK/],
    [{ resultado: "em_andamento" }, /CHECK/],
    [{ resultado: "falha" }, /CHECK/],
    [{ erro: "e" }, /CHECK/],
    [{ modelo_provedor: "openai" }, /CHECK/],
    [{ modelo_nome: "gpt" }, /CHECK/],
  ]);
  execucao({ resultado: "falha", erro: "e", modelo_provedor: "openai", modelo_nome: "gpt", pgid_pi: 10 });
  const rodando = { resultado: "em_andamento", terminada_em: null };
  execucao({ ...rodando, modo: "interativo" });
  // Uma execução em andamento por ticket, de qualquer modo.
  violam(execucao, [[{ ...rodando, modo: "consulta" }, /UNIQUE constraint failed: execucao.ticket/]]);
  execucao({ ...rodando, ticket: b.ticket });
  // Sem o D8: autônomas em andamento em issues diferentes passam.
  const c = emDesenho(banco, "outro");
  execucao({ ...rodando, ticket: c.ticket });
  assert.throws(() => {
    banco.exec(`DELETE FROM ticket WHERE id = ${String(a.ticket)}`);
  }, /FOREIGN KEY/);
  banco.close();
});

/** Processo filho que abre o banco, avisa `pronto`, espera uma linha no stdin e tenta iniciar a execução autônoma. */
const CORREDOR = `
  const { env } = process;
  const { abrir } = await import(env.BANCO);
  const { comIssue } = await import(env.ISSUES);
  const { iniciarExecucao } = await import(env.EXECUCAO);
  const banco = abrir(env.RAIZ);
  const ator = { tipo: "fabriquinha" };
  const entrada = { ticket: Number(env.TICKET), modo: "autonomo", sessaoPi: env.SESSAO };
  process.stdout.write("pronto\\n");
  await new Promise((largada) => process.stdin.once("data", largada));
  try {
    comIssue(banco, Number(env.ISSUE), "iniciarExecucao", ator, (ag, ctx) => iniciarExecucao(ag, entrada, ator, ctx));
    process.stdout.write("ok\\n");
  } catch (erro) {
    process.stdout.write(erro.name + ": " + erro.message + "\\n");
  }
  banco.close();
  process.exit(0);
`;

test(
  "corrida na mesma issue: dois processos iniciam juntos o mesmo ticket de desenvolvimento; um consegue, o outro recebe ErroDeRegra",
  { timeout: 30_000 },
  async () => {
    const raiz = mkdtempSync(join(base, "corrida-"));
    const preparado = novoBanco(raiz);
    const { issue: alvo } = emDesenho(preparado, "loja");
    const ids = comIssue(preparado, alvo, "editarIssue", auditor, (atual, ctx) => {
      const abertos = [{ ...ticketBase(alvo), id: ctx.novoId("ticket"), criadoEm: ctx.agora }];
      return {
        ...atual,
        issue: { ...atual.issue, fase: "desenvolvimento" },
        tickets: [
          ...atual.tickets.map((t) => ({ ...t, status: "concluido" as const, concluidoEm: ctx.agora })),
          ...abertos,
        ],
      };
    }).tickets.slice(-1);
    const alvos = [...ids, ...ids].map(({ id }) => ({ issue: alvo, ticket: id }));
    preparado.close();

    const corredores = alvos.map(({ issue, ticket }) => {
      const filho = spawn(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", CORREDOR],
        {
          env: {
            ...process.env,
            BANCO: new URL("banco.ts", import.meta.url).href,
            ISSUES: new URL("issues.ts", import.meta.url).href,
            EXECUCAO: new URL("../dominio/execucao.ts", import.meta.url).href,
            RAIZ: raiz,
            ISSUE: String(issue),
            TICKET: String(ticket),
            SESSAO,
          },
          stdio: ["pipe", "pipe", "inherit"],
        },
      );
      let saida = "";
      filho.stdout.setEncoding("utf8");
      const fim = once(filho, "close").then(() => saida.replace("pronto\n", "").trim());
      // O filho que morre antes de ficar pronto falha o teste em vez de deixá-lo esperando para sempre.
      const pronto = Promise.race([
        new Promise<void>((resolve) => {
          filho.stdout.on("data", (parte: string) => {
            saida += parte;
            if (saida.includes("pronto\n")) resolve();
          });
        }),
        fim.then((resto) => {
          throw new Error(`o processo filho saiu antes de ficar pronto: ${resto}`);
        }),
      ]);
      return { filho, pronto, fim };
    });
    await Promise.all(corredores.map((c) => c.pronto));
    for (const { filho } of corredores) filho.stdin.end("vai\n");
    const resultados = await Promise.all(corredores.map((c) => c.fim));

    assert.deepEqual(resultados.toSorted(), [
      "ErroDeRegra: a I-1 já tem a execução E-1 em andamento (espere ela terminar)",
      "ok",
    ]);
    const lido = abrir(raiz);
    assert.deepEqual(
      lido
        .prepare("SELECT modo, resultado FROM execucao")
        .all()
        .map((e) => Object.values(e)),
      [["autonomo", "em_andamento"]],
    );
    lido.close();
  },
);

const SHA = (letra: string) => letra.repeat(64);

/** I-1 em `registro` com título e tipo e o ticket de registro T-1 rodando na E-1, interativa. */
function registroRodando(banco: DatabaseSync): Ator {
  const { issue } = registrarIssue(banco, { projeto: "loja" }, auditor);
  comIssue(banco, issue.id, "editarIssue", auditor, (ag) =>
    editarIssue(ag, { titulo: "T", tipo: "problema" }, auditor),
  );
  iniciar(banco, issue.id, 1, "interativo");
  return { tipo: "agente", execucao: 1, ticket: 1 };
}

const evidenciar = (banco: DatabaseSync, ator: Ator, tipo: string, arquivos: string[] = []) =>
  comIssue(banco, 1, "registrarEvidencia", ator, (ag, ctx) =>
    registrarEvidencia(
      ag,
      {
        ticket: 1,
        tipo,
        dados: { tipo, lista: [1, "a", null] },
        arquivos: arquivos.map((letra, i) => ({
          nome: `${letra}${String(i)}.txt`,
          sha256: SHA(letra),
          mime: "text/plain",
          bytes: i,
        })),
      },
      ator,
      ctx,
    ),
  );

test("C17 pelo comIssue grava evidência e anexos; resubmeter troca as linhas e o agregado relido é igual", () => {
  const banco = novoBanco();
  const agente = registroRodando(banco);
  const primeiro = evidenciar(banco, agente, "comportamento", ["a", "b"]);
  assert.deepEqual(agregado(banco, 1), primeiro);
  assert.deepEqual(
    todas(banco, "SELECT evidencia, nome, sha256, mime, bytes FROM evidencia_arquivo ORDER BY rowid").map((l) =>
      Object.values(l),
    ),
    [
      [1, "a0.txt", SHA("a"), "text/plain", 0],
      [1, "b1.txt", SHA("b"), "text/plain", 1],
    ],
  );
  evidenciar(banco, agente, "criterios_aceite");
  const depois = evidenciar(banco, agente, "comportamento", ["c"]);

  assert.deepEqual(
    depois.evidencias.map((e) => [e.id, e.tipo, e.produtor, e.arquivos.map((a) => a.nome)]),
    [
      [2, "criterios_aceite", "agente", []],
      [3, "comportamento", "agente", ["c0.txt"]],
    ],
  );
  assert.deepEqual(agregado(banco, 1), depois);
  assert.deepEqual(
    todas(banco, "SELECT evidencia, nome FROM evidencia_arquivo").map((l) => Object.values(l)),
    [[3, "c0.txt"]],
  );
  assert.equal(
    valor(banco, "SELECT dados FROM evidencia WHERE id = 3"),
    '{"tipo":"comportamento","lista":[1,"a",null]}',
  );
  assert.equal(valor(banco, "SELECT count(*) FROM comando WHERE nome = 'registrarEvidencia' AND ator = 'agente'"), 3);
  banco.close();
});

test("C10 pelo comIssue: reprovado devolve o envio; reenviado e aprovado, a issue vai a desenho com o ticket novo", () => {
  const banco = novoBanco();
  const agente = registroRodando(banco);
  evidenciar(banco, agente, "comportamento");
  evidenciar(banco, agente, "criterios_aceite");
  const enviar = (ator: Ator) =>
    comIssue(banco, 1, "enviarParaAprovacao", ator, (ag, ctx) => enviarParaAprovacao(ag, { ticket: 1 }, ator, ctx));
  const terminarSessao = (execucao: number) =>
    comIssue(banco, 1, "terminarExecucao", fabriquinha, (ag, ctx) =>
      terminarExecucao(ag, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
    );
  const decidir = (entrada: unknown) =>
    comIssue(banco, 1, "decidirRegistro", auditor, (ag, ctx) => decidirRegistro(ag, entrada, auditor, ctx));
  assert.match(String(enviar(agente).tickets[0]?.enviadoEm), INSTANTE);
  regra(
    () => decidir({ aprovado: true }),
    "T-1 não pode passar pelo gate: a execução E-1 ainda está em andamento (espere ela terminar)",
  );
  terminarSessao(1);

  const reprovado = decidir({ aprovado: false, motivo: "faltou o vídeo" });
  assert.equal(reprovado.issue.fase, "registro");
  assert.equal(valor(banco, "SELECT enviado_em FROM ticket WHERE id = 1"), null);
  // A sessão retoma (F4 §6.6), o agente ajusta e envia de novo.
  iniciar(banco, 1, 1, "interativo");
  enviar({ tipo: "agente", execucao: 2, ticket: 1 });
  terminarSessao(2);
  const aprovado = decidir({ aprovado: true });
  assert.deepEqual(agregado(banco, 1), aprovado);
  assert.equal(aprovado.issue.fase, "desenho");
  assert.deepEqual(
    aprovado.tickets.map((t) => [t.id, t.etapa, t.status]),
    [
      [1, "registro", "concluido"],
      [2, "desenho", "aberto"],
    ],
  );
  assert.deepEqual(
    todas(banco, "SELECT id, issue, ticket, gate, aprovado, motivo, nota, por FROM decisao ORDER BY id").map((l) =>
      Object.values(l),
    ),
    [
      [1, 1, 1, "registro", 0, "faltou o vídeo", null, "auditor"],
      [2, 1, 1, "registro", 1, null, null, "auditor"],
    ],
  );
  assert.deepEqual(
    todas(banco, "SELECT fase FROM comando WHERE nome = 'decidirRegistro'").map((l) => l.fase),
    ["registro", "registro"],
  );
  assert.equal(valor(banco, "SELECT count(*) FROM comando WHERE nome = 'enviarParaAprovacao' AND ator = 'agente'"), 2);
  banco.close();
});

test("as constraints da tabela decisao valem no banco (nota só no PR aprovado, como no F1 §3.7)", () => {
  const banco = novoBanco();
  registrarIssue(banco, { projeto: "loja" }, auditor);
  const decisao = inseridor(banco, "decisao", {
    issue: 1,
    ticket: 1,
    gate: "registro",
    aprovado: 1,
    por: "auditor",
    em: "x",
  });
  violam(decisao, [
    [{ issue: 9 }, /FOREIGN KEY/],
    [{ ticket: 9 }, /FOREIGN KEY/],
    [{ gate: "codigo" }, /CHECK/],
    [{ aprovado: 2 }, /CHECK/],
    [{ motivo: "" }, /CHECK/],
    [{ motivo: "a".repeat(2001) }, /CHECK/],
    [{ por: "fabriquinha" }, /CHECK/],
    [{ em: null }, /NOT NULL/],
    // Invariante 7: revisão é do agente; os outros gates, do Auditor.
    [{ por: "agente" }, /CHECK/],
    [{ gate: "revisao" }, /CHECK/],
    // Reprovar exige motivo.
    [{ aprovado: 0 }, /CHECK/],
    // Nota se e somente se PR aprovado.
    [{ nota: 3 }, /CHECK/],
    [{ gate: "pr" }, /CHECK/],
    [{ gate: "pr", aprovado: 0, motivo: "m", nota: 3 }, /CHECK/],
    [{ gate: "pr", nota: 0 }, /CHECK/],
    [{ gate: "pr", nota: 6 }, /CHECK/],
  ]);
  decisao();
  decisao({ aprovado: 0, motivo: "m" });
  decisao({ gate: "pr", nota: 5 });
  decisao({ gate: "pr", aprovado: 0, motivo: "m" });
  const revisao = { gate: "revisao", por: "agente" };
  decisao(revisao);
  // Uma decisão de revisão por ticket.
  violam(decisao, [[revisao, /UNIQUE constraint failed: decisao.ticket/]]);
  assert.throws(() => {
    banco.exec("DELETE FROM ticket WHERE id = 1");
  }, /FOREIGN KEY/);
  banco.close();
});

test("as constraints de evidencia e evidencia_arquivo valem no banco; apagar a evidência leva os anexos", () => {
  const banco = novoBanco();
  registrarIssue(banco, { projeto: "loja" }, auditor);
  const evidencia = inseridor(banco, "evidencia", { ticket: 1, tipo: "comportamento", produtor: "agente", em: "x" });
  violam(evidencia, [
    [{ ticket: 9 }, /FOREIGN KEY/],
    [{ tipo: "video" }, /CHECK/],
    [{ produtor: "auditor" }, /CHECK/],
    [{ aprovada: 2 }, /CHECK/],
    [{ dados: "{" }, /CHECK/],
    [{ dados: null }, /NOT NULL/],
    [{ em: null }, /NOT NULL/],
  ]);
  evidencia({ id: 1 });
  assert.equal(valor(banco, "SELECT dados FROM evidencia"), "{}");
  // Uma evidência por (ticket, tipo).
  violam(evidencia, [[{}, /UNIQUE constraint failed: evidencia.ticket, evidencia.tipo/]]);
  evidencia({ tipo: "execucao_testes", produtor: "fabriquinha", aprovada: 1 });

  const arquivo = inseridor(banco, "evidencia_arquivo", {
    evidencia: 1,
    nome: "a.webm",
    sha256: SHA("a"),
    mime: "video/webm",
    bytes: 0,
  });
  violam(arquivo, [
    [{ evidencia: 9 }, /FOREIGN KEY/],
    [{ nome: "" }, /CHECK/],
    [{ nome: "a".repeat(201) }, /CHECK/],
    [{ sha256: "abc" }, /CHECK/],
    [{ bytes: -1 }, /CHECK/],
    [{ mime: null }, /NOT NULL/],
  ]);
  arquivo();
  violam(arquivo, [[{}, /UNIQUE constraint failed: evidencia_arquivo.evidencia, evidencia_arquivo.nome/]]);
  assert.throws(() => {
    banco.exec("DELETE FROM ticket WHERE id = 1");
  }, /FOREIGN KEY/);
  banco.exec("DELETE FROM evidencia WHERE id = 1");
  assert.equal(valor(banco, "SELECT count(*) FROM evidencia_arquivo"), 0);
  banco.close();
});

test("gate de desenho pelo comIssue: C11, C17 e C25 do agente; C11 a C13 e C15 reprovado do Auditor", () => {
  const banco = novoBanco();
  const { issue, ticket } = emDesenho(banco);
  const execucao = iniciar(banco, issue, ticket, "interativo").execucoes[0]?.id ?? 0;
  const agente: Ator = { tipo: "agente", execucao, ticket };
  comIssue(banco, issue, "adicionarTicketDesenvolvimento", agente, (ag, ctx) =>
    adicionarTicketDesenvolvimento(ag, { titulo: "Cache do login" }, agente, ctx),
  );
  for (const tipo of ["desenho_solucao", "relatorio_complexidade", "relatorio_impactos_arquitetura"]) {
    comIssue(banco, issue, "registrarEvidencia", agente, (ag, ctx) =>
      registrarEvidencia(ag, { ticket, tipo, dados: {}, arquivos: [] }, agente, ctx),
    );
  }
  const enviado = comIssue(banco, issue, "enviarParaAprovacao", agente, (ag, ctx) =>
    enviarParaAprovacao(ag, { ticket }, agente, ctx),
  );
  comIssue(banco, issue, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
  );
  assert.equal(enviado.issue.fase, "aprovacao_desenho");
  assert.deepEqual(agregado(banco, issue)?.tickets, enviado.tickets);

  const modelo = { provedor: "openai", modelo: "gpt-5" };
  comIssue(banco, issue, "adicionarTicketDesenvolvimento", auditor, (ag, ctx) =>
    adicionarTicketDesenvolvimento(ag, { titulo: "Índice", modelo }, auditor, ctx),
  );
  comIssue(banco, issue, "editarTicket", auditor, (ag) => editarTicket(ag, { ticket: 3, titulo: "Cache" }, auditor));
  const ajustado = comIssue(banco, issue, "removerTicket", auditor, (ag) => removerTicket(ag, { ticket: 4 }, auditor));
  assert.deepEqual(agregado(banco, issue), ajustado);
  assert.deepEqual(
    ajustado.tickets.map((t) => [t.id, t.etapa, t.status, t.titulo, t.origem, t.origemTicket]),
    [
      [1, "registro", "concluido", "Registrar a necessidade", "fabriquinha", undefined],
      [2, "desenho", "em_execucao", "Ticket", "fabriquinha", undefined],
      [3, "desenvolvimento", "aberto", "Cache", "agente", 2],
    ],
  );

  const reprovado = comIssue(banco, issue, "decidirDesenho", auditor, (ag, ctx) =>
    decidirDesenho(ag, { aprovado: false, motivo: "faltou o índice" }, auditor, ctx),
  );
  assert.deepEqual(agregado(banco, issue), reprovado);
  // Reprovado, o mesmo desenho volta à conversa, sem o envio, com os tickets propostos.
  assert.deepEqual(
    todas(banco, "SELECT id, etapa, status, enviado_em FROM ticket ORDER BY id").map((l) => Object.values(l)),
    [
      [1, "registro", "concluido", null],
      [2, "desenho", "em_execucao", null],
      [3, "desenvolvimento", "aberto", null],
    ],
  );
  assert.deepEqual(
    todas(banco, "SELECT ticket, gate, aprovado, motivo, por FROM decisao").map((l) => Object.values(l)),
    [[2, "desenho", 0, "faltou o índice", "auditor"]],
  );
  // M3 (F6 §5.1): os ajustes do Auditor nos tickets propostos ficam em `comando`, na fase do gate.
  assert.deepEqual(
    todas(
      banco,
      "SELECT nome, ator, fase FROM comando WHERE fase = 'aprovacao_desenho' AND ator = 'auditor' ORDER BY id",
    ).map((l) => Object.values(l)),
    [
      ["adicionarTicketDesenvolvimento", "auditor", "aprovacao_desenho"],
      ["editarTicket", "auditor", "aprovacao_desenho"],
      ["removerTicket", "auditor", "aprovacao_desenho"],
      ["decidirDesenho", "auditor", "aprovacao_desenho"],
    ],
  );
  banco.close();
});

/** Põe a issue em `desenvolvimento` com o ticket de registro `em_execucao` e a execução dele em andamento. */
const emExecucao = (banco: DatabaseSync, issue: number) =>
  comIssue(banco, issue, "editarIssue", auditor, (ag, ctx) => ({
    ...ag,
    issue: { ...ag.issue, titulo: "T", tipo: "problema", fase: "desenvolvimento" },
    tickets: ag.tickets.map((t) => ({ ...t, status: "em_execucao" })),
    execucoes: [
      {
        id: ctx.novoId("execucao"),
        ticket: ag.tickets[0]?.id ?? 0,
        modo: "autonomo",
        sessaoPi: SESSAO,
        resultado: "em_andamento",
        iniciadaEm: ctx.agora,
      },
    ],
  }));

test("cancelarIssues cancela a issue e as dependentes diretas e indiretas de qualquer projeto, não as dependências", () => {
  const banco = novoBanco();
  const a = registrarIssue(banco, { projeto: "loja" }, auditor).issue.id;
  const b = registrarIssue(banco, { projeto: "outro", deps: [a] }, auditor).issue.id;
  const c = registrarIssue(banco, { projeto: "loja", deps: [b] }, auditor).issue.id;
  const livre = registrarIssue(banco, { projeto: "loja" }, auditor).issue.id;
  emExecucao(banco, c);
  const antes = agregado(banco, a);

  assert.deepEqual(dependentes(banco, a), [
    { id: b, projeto: "outro", fase: "registro" },
    { id: c, projeto: "loja", fase: "desenvolvimento" },
  ]);
  const { issues, execucoes } = cancelarIssues(banco, a, auditor);

  assert.deepEqual(issues, [a, b, c]);
  assert.deepEqual(
    execucoes.map((e) => [e.ticket, e.resultado, e.erro]),
    [[c, "falha", CANCELADA]],
  );
  for (const id of [a, b, c]) {
    const ag = agregado(banco, id);
    assert.match(String(ag?.issue.canceladaEm), INSTANTE);
    assert.equal(
      ag?.tickets.some((t) => t.status === "aberto"),
      false,
    );
  }
  assert.deepEqual(
    agregado(banco, c)?.tickets.map((t) => t.status),
    ["cancelado"],
  );
  assert.deepEqual(
    agregado(banco, a)?.tickets.map((t) => t.status),
    ["fechado"],
  );
  assert.equal(agregado(banco, a)?.issue.fase, antes?.issue.fase);
  assert.equal(agregado(banco, livre)?.issue.canceladaEm, undefined);
  assert.deepEqual(
    todas(banco, "SELECT issue, nome, ator, fase FROM comando WHERE nome = 'cancelarIssue' ORDER BY issue").map(
      (l) => ({
        ...l,
      }),
    ),
    [
      { issue: a, nome: "cancelarIssue", ator: "auditor", fase: "registro" },
      { issue: b, nome: "cancelarIssue", ator: "auditor", fase: "registro" },
      { issue: c, nome: "cancelarIssue", ator: "auditor", fase: "desenvolvimento" },
    ],
  );
  assert.deepEqual(dependentes(banco, a), []); // já canceladas
  assert.equal(valor(banco, "SELECT count(*) FROM execucao WHERE resultado = 'em_andamento'"), 0);
  banco.close();
});

test("cancelarIssues na dependente não cancela a issue de que ela depende", () => {
  const banco = novoBanco();
  const a = registrarIssue(banco, { projeto: "loja" }, auditor).issue.id;
  const b = registrarIssue(banco, { projeto: "loja", deps: [a] }, auditor).issue.id;

  assert.deepEqual(cancelarIssues(banco, b, auditor), { issues: [b], execucoes: [] });
  assert.equal(agregado(banco, a)?.issue.canceladaEm, undefined);
  assert.notEqual(agregado(banco, b)?.issue.canceladaEm, undefined);
  banco.close();
});

test("cancelarIssues recusa sem gravar nada: inexistente, não Auditor, concluída e já cancelada", () => {
  const banco = novoBanco();
  const a = registrarIssue(banco, { projeto: "loja" }, auditor).issue.id;
  registrarIssue(banco, { projeto: "loja", deps: [a] }, auditor);
  const concluida = comIssue(banco, a, "editarIssue", auditor, (ag, ctx) => ({
    ...ag,
    issue: { ...ag.issue, titulo: "T", tipo: "problema", fase: "concluida", concluidaEm: ctx.agora },
  }));

  assert.throws(() => cancelarIssues(banco, 99, auditor), ErroDeInexistente);
  assert.throws(() => cancelarIssues(banco, a, { tipo: "agente", execucao: 1, ticket: 1 }), ErroDeEscopo);
  regra(
    () => cancelarIssues(banco, a, auditor),
    "a I-1 está concluída e não pode ser cancelada (ela já terminou o processo)",
  );
  assert.deepEqual(agregado(banco, a), concluida);
  assert.equal(agregado(banco, 2)?.issue.canceladaEm, undefined);

  const nova = registrarIssue(banco, { projeto: "loja" }, auditor).issue.id;
  cancelarIssues(banco, nova, auditor);
  regra(() => cancelarIssues(banco, nova, auditor), "a I-3 já está cancelada (não há mais nada a fazer)");
  banco.close();
});

test("dependentes deixa de fora as concluídas mas segue por elas", () => {
  const banco = novoBanco();
  const a = registrarIssue(banco, { projeto: "loja" }, auditor).issue.id;
  const b = registrarIssue(banco, { projeto: "loja", deps: [a] }, auditor).issue.id;
  const c = registrarIssue(banco, { projeto: "loja", deps: [b] }, auditor).issue.id;
  comIssue(banco, b, "editarIssue", auditor, (ag, ctx) => ({
    ...ag,
    issue: { ...ag.issue, titulo: "T", tipo: "problema", fase: "concluida", concluidaEm: ctx.agora },
  }));

  assert.deepEqual(
    dependentes(banco, a).map((d) => d.id),
    [c],
  );
  banco.close();
});

test("comIssue recusa qualquer comando sobre issue cancelada, sem gravar nada", () => {
  const banco = novoBanco();
  const { issue } = registrarIssue(banco, { projeto: "loja" }, auditor);
  cancelarIssues(banco, issue.id, auditor);
  const antes = agregado(banco, issue.id);
  const comandos = valor(banco, "SELECT count(*) FROM comando");

  regra(
    () => comIssue(banco, issue.id, "editarIssue", auditor, (ag) => editarIssue(ag, { titulo: "x" }, auditor)),
    "a I-1 está cancelada e não muda mais (registre uma nova issue se precisar)",
  );
  assert.deepEqual(agregado(banco, issue.id), antes);
  assert.equal(valor(banco, "SELECT count(*) FROM comando"), comandos);
  banco.close();
});

test("issuesEmAndamento e situacaoDasIssues excluem e marcam a cancelada", () => {
  const banco = novoBanco();
  const a = registrarIssue(banco, { projeto: "loja" }, auditor).issue.id;
  const b = registrarIssue(banco, { projeto: "loja" }, auditor).issue.id;
  cancelarIssues(banco, a, auditor);

  assert.deepEqual(issuesEmAndamento(banco), [b]);
  assert.deepEqual(situacaoDasIssues(banco, "loja"), [
    { id: b, concluida: false, arquivada: false, cancelada: false },
    { id: a, concluida: false, arquivada: false, cancelada: true },
  ]);
  banco.close();
});

const PROPOSTA = { titulo: "Tela de relatório", mensagem: "Parte B: tela de relatório", arquivos: 31 };

test("C23 grava a proposta presa ao ticket, fora do agregado, e propostasDaIssue a lê", () => {
  const banco = novoBanco();
  const agente = registroRodando(banco);
  const antes = agregado(banco, 1);

  const p = proporIssue(banco, 1, PROPOSTA, agente);

  assert.deepEqual(p, { id: 1, ticket: 1, ...PROPOSTA, status: "pendente", em: p.em });
  assert.match(p.em, INSTANTE);
  assert.deepEqual(propostasDaIssue(banco, 1), [p]);
  assert.deepEqual(propostasDaIssue(banco, 2), []);
  assert.deepEqual(agregado(banco, 1), antes);
  assert.equal(proporIssue(banco, 1, { ...PROPOSTA, arquivos: 0 }, agente).id, 2);
  assert.deepEqual(
    propostasDaIssue(banco, 1).map((x) => x.id),
    [1, 2],
  );
  assert.deepEqual(
    todas(banco, "SELECT nome, ator, fase FROM comando WHERE nome = 'proporIssue'").map((l) => Object.values(l)),
    [
      ["proporIssue", "agente", "registro"],
      ["proporIssue", "agente", "registro"],
    ],
  );
  banco.close();
});

test("C23 recusa sem gravar nada: Auditor, entrada inválida e issue inexistente", () => {
  const banco = novoBanco();
  const agente = registroRodando(banco);
  assert.throws(() => proporIssue(banco, 1, PROPOSTA, auditor), ErroDeEscopo);
  assert.throws(() => proporIssue(banco, 1, { ...PROPOSTA, titulo: "" }, agente), ZodError);
  assert.throws(() => proporIssue(banco, 9, PROPOSTA, agente), ErroDeInexistente);
  assert.equal(valor(banco, "SELECT count(*) FROM proposta_issue"), 0);
  assert.equal(valor(banco, "SELECT count(*) FROM comando WHERE nome = 'proporIssue'"), 0);
  assert.equal(banco.isTransaction, false);
  banco.close();
});

test("C24 aceita no registro: grava a issue nova dependente da atual, a proposta e o comando numa transação", () => {
  const banco = novoBanco();
  const agente = registroRodando(banco);
  proporIssue(banco, 1, PROPOSTA, agente);
  const antes = agregado(banco, 1);

  const { ag, proposta, nova } = decidirProposta(banco, 1, { aceita: true }, auditor);

  assert.equal(nova?.issue.id, 2);
  assert.deepEqual(agregado(banco, 2), nova);
  assert.deepEqual(
    [nova.issue.titulo, nova.issue.descricao, nova.issue.deps, nova.issue.fase],
    ["Tela de relatório", "Parte B: tela de relatório", [1], "registro"],
  );
  assert.deepEqual(agregado(banco, 1), antes);
  assert.deepEqual(ag, antes);
  assert.deepEqual(propostasDaIssue(banco, 1), [proposta]);
  assert.deepEqual([proposta.status, proposta.issueCriada, proposta.decididaEm], ["aceita", 2, proposta.decididaEm]);
  assert.match(proposta.decididaEm ?? "", INSTANTE);
  assert.deepEqual(
    todas(banco, "SELECT issue, nome, ator, fase FROM comando WHERE nome = 'decidirProposta'").map((l) =>
      Object.values(l),
    ),
    [[1, "decidirProposta", "auditor", "registro"]],
  );
  banco.close();
});

test("C24 recusa grava só a proposta; decidir de novo, proposta inexistente e não Auditor não gravam nada", () => {
  const banco = novoBanco();
  const agente = registroRodando(banco);
  proporIssue(banco, 1, PROPOSTA, agente);
  assert.throws(() => decidirProposta(banco, 1, { aceita: true }, agente), ErroDeEscopo);
  assert.throws(() => decidirProposta(banco, 7, { aceita: true }, auditor), ErroDeInexistente);
  assert.equal(propostasDaIssue(banco, 1)[0]?.status, "pendente");

  const recusada = decidirProposta(banco, 1, { aceita: false }, auditor);
  assert.equal(recusada.nova, undefined);
  assert.deepEqual(
    [recusada.proposta.status, recusada.proposta.issueCriada, recusada.proposta.decididaEm !== undefined],
    ["recusada", undefined, true],
  );
  assert.equal(valor(banco, "SELECT count(*) FROM issue"), 1);

  regra(
    () => decidirProposta(banco, 1, { aceita: true }, auditor),
    "a proposta P-1 já foi decidida: recusada (uma proposta só se decide uma vez)",
  );
  assert.equal(valor(banco, "SELECT count(*) FROM issue"), 1);
  assert.equal(valor(banco, "SELECT count(*) FROM comando WHERE nome = 'decidirProposta'"), 1);
  banco.close();
});

test("C24 aceita duas vezes cria uma issue só: a segunda é recusada", () => {
  const banco = novoBanco();
  proporIssue(banco, 1, PROPOSTA, registroRodando(banco));
  decidirProposta(banco, 1, { aceita: true }, auditor);
  regra(
    () => decidirProposta(banco, 1, { aceita: true }, auditor),
    "a proposta P-1 já foi decidida: aceita (uma proposta só se decide uma vez)",
  );
  assert.equal(valor(banco, "SELECT count(*) FROM issue"), 2);
  banco.close();
});

test("C24 recusa a proposta cuja issue foi cancelada, sem gravar nada", () => {
  const banco = novoBanco();
  const agente = registroRodando(banco);
  proporIssue(banco, 1, PROPOSTA, agente);
  cancelarIssues(banco, 1, auditor);
  regra(
    () => decidirProposta(banco, 1, { aceita: true }, auditor),
    "a I-1 está cancelada e não muda mais (registre uma nova issue se precisar)",
  );
  assert.equal(valor(banco, "SELECT count(*) FROM issue"), 1);
  assert.equal(propostasDaIssue(banco, 1)[0]?.status, "pendente");
  banco.close();
});

test("C24 aceita no desenho: cria a issue nova e devolve o desenho como reprovado, na mesma transação", () => {
  const banco = novoBanco();
  const { issue, ticket } = emDesenho(banco);
  const execucao = iniciar(banco, issue, ticket, "interativo").execucoes[0]?.id ?? 0;
  const agente: Ator = { tipo: "agente", execucao, ticket };
  const p = proporIssue(banco, issue, PROPOSTA, agente);
  regra(
    () => decidirProposta(banco, p.id, { aceita: true }, auditor),
    "a proposta P-1 não está no gate atual da I-1 (o gate dela já passou ou ela é de outra issue)",
  );
  comIssue(banco, issue, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
  );
  // O desenho enviado (C25), sem as evidências que o C25 exigiria: aqui só importa a fase do gate.
  comIssue(banco, issue, "editarIssue", auditor, (ag, ctx) => ({
    ...ag,
    issue: { ...ag.issue, fase: "aprovacao_desenho" },
    tickets: ag.tickets.map((t) => (t.id === ticket ? { ...t, enviadoEm: ctx.agora } : t)),
  }));

  const { ag, proposta, nova } = decidirProposta(banco, p.id, { aceita: true }, auditor);

  assert.equal(proposta.issueCriada, nova?.issue.id);
  assert.deepEqual(nova?.issue.deps, [issue]);
  assert.deepEqual(agregado(banco, issue), ag);
  assert.equal(ag.issue.fase, "desenho");
  assert.deepEqual(
    todas(banco, "SELECT ticket, gate, aprovado, por FROM decisao").map((l) => Object.values(l)),
    [[ticket, "desenho", 0, "auditor"]],
  );
  assert.match(
    String(valor(banco, "SELECT motivo FROM decisao WHERE gate = 'desenho'")),
    /I-2 \(«Tela de relatório»\)/,
  );
  assert.equal(valor(banco, `SELECT enviado_em FROM ticket WHERE id = ${String(ticket)}`), null);
  assert.deepEqual(
    todas(banco, "SELECT nome, fase FROM comando WHERE nome = 'decidirProposta'").map((l) => Object.values(l)),
    [["decidirProposta", "aprovacao_desenho"]],
  );
  banco.close();
});

test("C24 no desenho com duas propostas: o primeiro aceite não reprova e o último grava o C15 com o lote", () => {
  const banco = novoBanco();
  const { issue, ticket } = emDesenho(banco);
  const execucao = iniciar(banco, issue, ticket, "interativo").execucoes[0]?.id ?? 0;
  const agente: Ator = { tipo: "agente", execucao, ticket };
  const p1 = proporIssue(banco, issue, PROPOSTA, agente);
  const p2 = proporIssue(banco, issue, { ...PROPOSTA, titulo: "Exportar CSV" }, agente);
  comIssue(banco, issue, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
  );
  comIssue(banco, issue, "editarIssue", auditor, (ag, ctx) => ({
    ...ag,
    issue: { ...ag.issue, fase: "aprovacao_desenho" },
    tickets: ag.tickets.map((t) => (t.id === ticket ? { ...t, enviadoEm: ctx.agora } : t)),
  }));

  const primeira = decidirProposta(banco, p1.id, { aceita: true }, auditor);
  assert.equal(primeira.lote, undefined);
  assert.equal(primeira.ag.issue.fase, "aprovacao_desenho");
  assert.equal(valor(banco, "SELECT count(*) FROM decisao"), 0);

  const ultima = decidirProposta(banco, p2.id, { aceita: false }, auditor);
  assert.deepEqual(
    ultima.lote?.map((p) => [p.id, p.status]),
    [
      [p1.id, "aceita"],
      [p2.id, "recusada"],
    ],
  );
  assert.equal(ultima.ag.issue.fase, "desenho");
  assert.match(
    String(valor(banco, "SELECT motivo FROM decisao WHERE gate = 'desenho'")),
    /^O Auditor decidiu as propostas de issue do desenho:\n- P-1 «Tela de relatório»: aceita;.*\n- P-2 «Exportar CSV»: recusada;/,
  );
  assert.equal(valor(banco, "SELECT count(*) FROM decisao"), 1);
  banco.close();
});

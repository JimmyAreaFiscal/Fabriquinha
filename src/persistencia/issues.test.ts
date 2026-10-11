import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { ZodError } from "zod";
import type { Ator, Ticket } from "../dominio/agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "../dominio/erros.ts";
import { adicionarDependencia, editarIssue, removerDependencia } from "../dominio/issue.ts";
import { abrir } from "./banco.ts";
import { agregado, arquivarConcluidas, comIssue, registrarIssue } from "./issues.ts";
import { registrarProjeto } from "./projetos.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-issues-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const auditor: Ator = { tipo: "auditor" };
const INSTANTE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** Banco novo com os projetos `loja` e `outro`. */
function novoBanco(): DatabaseSync {
  const banco = abrir(mkdtempSync(join(base, "raiz-")));
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
  comIssue(banco, id, "editarIssue", auditor, (ag, ctx) =>
    editarIssue(ag, { titulo: "Login lento", tipo: "problema" }, auditor, ctx),
  );
  comIssue(banco, id, "adicionarDependencia", auditor, (ag, ctx) => adicionarDependencia(ag, b.issue.id, auditor, ctx));
  comIssue(banco, id, "adicionarDependencia", auditor, (ag, ctx) => adicionarDependencia(ag, b.issue.id, auditor, ctx));
  const depois = comIssue(banco, id, "removerDependencia", auditor, (ag, ctx) =>
    removerDependencia(ag, b.issue.id, auditor, ctx),
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
        return editarIssue(atual, { tipo: "bug" }, auditor, ctx);
      }),
    ZodError,
  );
  assert.deepEqual(agregado(banco, 1), ag);
  assert.equal(valor(banco, "SELECT count(*) FROM comando"), 0);
  assert.equal(valor(banco, "SELECT valor FROM sequencia WHERE nome = 'ticket'"), 1);
  banco.close();
});

test("comIssue: agente sem execução em andamento recebe ErroDeEscopo", () => {
  const banco = novoBanco();
  const { issue, tickets } = registrarIssue(banco, { projeto: "loja" }, auditor);
  const agente: Ator = { tipo: "agente", execucao: 7, ticket: tickets[0]?.id ?? 0 };
  assert.throws(
    () => comIssue(banco, issue.id, "editarIssue", agente, (ag, ctx) => editarIssue(ag, { titulo: "T" }, agente, ctx)),
    (e) => e instanceof ErroDeEscopo && e.message === "a execução E-7 já terminou (peça ao Auditor uma nova execução)",
  );
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
    [{ status: "cancelado" }, /CHECK/],
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

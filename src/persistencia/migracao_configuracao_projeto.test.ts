import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Effort, EtapaTicket } from "../dominio/primitivos.ts";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const V22 = 22;
const etapa0 = EtapaTicket.options[0] ?? "";
const TABELAS = [
  "configuracao_etapa_projeto",
  "comando_preparacao_projeto",
  "fitness_function_projeto",
  "linguagem_projeto",
  "configuracao_e2e",
  "glob_e2e",
];

/** A última versão antes da remoção do fluxo legado (migração 33), que apagaria as colunas que estes testes gravam. */
const ANTES_DA_REMOCAO = 32;

const abrirBanco = (versao: number): DatabaseSync => {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrar(banco, MIGRACOES.slice(0, versao));
  return banco;
};

const projeto = (banco: DatabaseSync, nome: string) =>
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
       VALUES (?, ?, 'main', 'github', '["npm test"]', 'chave', '[{"nome":"f"}]')`,
    )
    .run(nome, `/repo/${nome}`);

const migrado = (): DatabaseSync => {
  const banco = abrirBanco(ANTES_DA_REMOCAO);
  projeto(banco, "a");
  projeto(banco, "b");
  banco.exec(`
    INSERT INTO linguagem_projeto VALUES ('a', '.', 'ts', 'npm test');
    INSERT INTO configuracao_e2e VALUES ('a', '.', 'build', 'run', 1);
    INSERT INTO glob_e2e VALUES ('a', '.', 'e2e/**');`);
  return banco;
};

const recusa = (banco: DatabaseSync, sql: string, padrao: RegExp) => {
  assert.throws(() => {
    banco.exec(sql);
  }, padrao);
};

const linhas = (banco: DatabaseSync, tabela: string) => banco.prepare(`SELECT * FROM ${tabela}`).all();
const versao = (banco: DatabaseSync) =>
  (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

test("a migração 23 vem depois das 22 anteriores", () => {
  assert.ok(MIGRACOES.length >= 23);
});

test("banco vazio e v22 chegam ao mesmo conjunto de tabelas novas, vazias", () => {
  const v22 = abrirBanco(V22);
  const colunas = (b: DatabaseSync) =>
    b
      .prepare("PRAGMA table_info(projeto)")
      .all()
      .map((c) => c.name);
  assert.ok(!colunas(v22).includes("cursor_commit_humano"));
  migrar(v22, MIGRACOES.slice(0, 23));
  assert.equal(versao(v22), 23);
  const vazio = abrirBanco(ANTES_DA_REMOCAO);
  assert.deepEqual(colunas(v22), colunas(vazio));
  for (const t of TABELAS) {
    assert.deepEqual(linhas(v22, t), []);
    assert.deepEqual(linhas(vazio, t), []);
  }
});

test("reabrir um banco já migrado não reaplica a migração", () => {
  const banco = abrirBanco(MIGRACOES.length);
  migrar(banco, MIGRACOES);
  assert.equal(versao(banco), MIGRACOES.length);
});

test("projetos legados ficam intactos, sem configuração nova e com cursor NULL", () => {
  const banco = abrirBanco(V22);
  projeto(banco, "legado");
  const antes = banco.prepare("SELECT * FROM projeto").all();
  migrar(banco, MIGRACOES.slice(0, ANTES_DA_REMOCAO));
  const depois = banco.prepare("SELECT * FROM projeto").all();
  assert.deepEqual(
    depois.map(({ cursor_commit_humano, ...resto }) => ({ ...resto })),
    antes.map((l) => ({ ...l })),
  );
  assert.equal(depois[0]?.cursor_commit_humano, null);
  for (const t of TABELAS) assert.deepEqual(linhas(banco, t), []);
});

test("chaves primárias e referências compostas", () => {
  const banco = abrirBanco(MIGRACOES.length);
  const pk = (t: string) =>
    banco
      .prepare(`PRAGMA table_info(${t})`)
      .all()
      .filter((c) => Number(c.pk) > 0)
      .sort((x, y) => Number(x.pk) - Number(y.pk))
      .map((c) => c.name);
  assert.deepEqual(pk("configuracao_etapa_projeto"), ["projeto", "etapa"]);
  assert.deepEqual(pk("comando_preparacao_projeto"), ["projeto", "ordem"]);
  assert.deepEqual(pk("fitness_function_projeto"), ["projeto", "nome"]);
  assert.deepEqual(pk("linguagem_projeto"), ["projeto", "caminho"]);
  assert.deepEqual(pk("configuracao_e2e"), ["projeto", "caminho_linguagem"]);
  assert.deepEqual(pk("glob_e2e"), ["projeto", "caminho_linguagem", "glob"]);

  const fks = (t: string) =>
    banco
      .prepare(`PRAGMA foreign_key_list(${t})`)
      .all()
      .map((f) => `${String(f.from)}->${String(f.table)}.${String(f.to)}:${String(f.on_delete)}`);
  for (const t of TABELAS) assert.ok(fks(t).includes("projeto->projeto.nome:CASCADE"), t);
  assert.deepEqual(fks("configuracao_e2e").filter((f) => !f.startsWith("projeto->projeto")).length, 2);
  assert.ok(fks("configuracao_e2e").includes("caminho_linguagem->linguagem_projeto.caminho:CASCADE"));
  assert.ok(fks("glob_e2e").includes("caminho_linguagem->configuracao_e2e.caminho_linguagem:CASCADE"));
});

test("chave duplicada e projeto pai inexistente são recusados", () => {
  const banco = migrado();
  recusa(banco, "INSERT INTO linguagem_projeto VALUES ('a', '.', 'x', 'y')", /UNIQUE|PRIMARY/);
  recusa(banco, "INSERT INTO linguagem_projeto VALUES ('nao', '.', 'x', 'y')", /FOREIGN KEY/);
  recusa(banco, "INSERT INTO comando_preparacao_projeto VALUES ('nao', 1, 'x')", /FOREIGN KEY/);
  banco.exec("INSERT INTO comando_preparacao_projeto VALUES ('a', 1, 'x')");
  recusa(banco, "INSERT INTO comando_preparacao_projeto VALUES ('a', 1, 'y')", /UNIQUE|PRIMARY/);
});

test("ordem inteira positiva e valores não vazios", () => {
  const banco = migrado();
  recusa(banco, "INSERT INTO comando_preparacao_projeto VALUES ('a', 0, 'x')", /CHECK/);
  recusa(banco, "INSERT INTO comando_preparacao_projeto VALUES ('a', -1, 'x')", /CHECK/);
  recusa(banco, "INSERT INTO comando_preparacao_projeto VALUES ('a', 1.5, 'x')", /CHECK|datatype/);
  recusa(banco, "INSERT INTO comando_preparacao_projeto VALUES ('a', 1, '')", /CHECK/);
  recusa(banco, "INSERT INTO fitness_function_projeto VALUES ('a', 'f', 'c', '')", /CHECK/);
  recusa(banco, "UPDATE projeto SET cursor_commit_humano = '' WHERE nome = 'a'", /CHECK/);
  banco.exec("UPDATE projeto SET cursor_commit_humano = 'abc' WHERE nome = 'a'");
});

test("codigo_falha só aceita inteiros de 1 a 255", () => {
  const banco = migrado();
  banco.exec("INSERT INTO linguagem_projeto VALUES ('a', 'x', 'ts', 't')");
  for (const codigo of [0, 256, -1, 1.5]) {
    recusa(banco, `INSERT INTO configuracao_e2e VALUES ('a', 'x', 'b', 'r', ${String(codigo)})`, /CHECK|datatype/);
  }
  banco.exec("INSERT INTO configuracao_e2e VALUES ('a', 'x', 'b', 'r', 255)");
  banco.exec("UPDATE configuracao_e2e SET codigo_falha = 1 WHERE caminho_linguagem = 'x'");
});

test("par de modelo nos dois sentidos, efforts e etapas", () => {
  const banco = migrado();
  const ins = (etapa: string, p: string, n: string, e: string) => {
    banco.exec(`INSERT INTO configuracao_etapa_projeto VALUES ('a', '${etapa}', ${p}, ${n}, ${e})`);
  };
  const [etapa] = EtapaTicket.options;
  assert.ok(etapa);
  recusa(banco, `INSERT INTO configuracao_etapa_projeto VALUES ('a', '${etapa}', 'p', NULL, NULL)`, /CHECK/);
  recusa(banco, `INSERT INTO configuracao_etapa_projeto VALUES ('a', '${etapa}', NULL, 'n', NULL)`, /CHECK/);
  recusa(banco, `INSERT INTO configuracao_etapa_projeto VALUES ('a', '${etapa}', '', '', NULL)`, /CHECK/);
  recusa(banco, `INSERT INTO configuracao_etapa_projeto VALUES ('a', '${etapa}', NULL, NULL, 'invalido')`, /CHECK/);
  recusa(banco, `INSERT INTO configuracao_etapa_projeto VALUES ('a', 'inexistente', NULL, NULL, NULL)`, /CHECK/);
  for (const [i, effort] of Effort.options.entries()) {
    const e = EtapaTicket.options[i];
    assert.ok(e);
    ins(e, "NULL", "NULL", `'${effort}'`);
  }
  ins(EtapaTicket.options[Effort.options.length] ?? "", "'p'", "'n'", "NULL");
  assert.equal(linhas(banco, "configuracao_etapa_projeto").length, Effort.options.length + 1);
});

test("E2E sem linguagem e glob sem E2E são recusados, inclusive entre projetos", () => {
  const banco = migrado();
  recusa(banco, "INSERT INTO configuracao_e2e VALUES ('a', 'falta', 'b', 'r', 1)", /FOREIGN KEY/);
  recusa(banco, "INSERT INTO configuracao_e2e VALUES ('b', '.', 'b', 'r', 1)", /FOREIGN KEY/);
  banco.exec("INSERT INTO linguagem_projeto VALUES ('a', 'sem-e2e', 'ts', 't')");
  recusa(banco, "INSERT INTO glob_e2e VALUES ('a', 'sem-e2e', 'g')", /FOREIGN KEY/);
  recusa(banco, "INSERT INTO glob_e2e VALUES ('b', '.', 'g')", /FOREIGN KEY/);
});

test("excluir um projeto cascateia seus filhos e preserva os de outro projeto", () => {
  const banco = migrado();
  banco.exec(`
    INSERT INTO linguagem_projeto VALUES ('b', '.', 'ts', 't');
    INSERT INTO configuracao_e2e VALUES ('b', '.', 'b', 'r', 2);
    INSERT INTO glob_e2e VALUES ('b', '.', 'g');
    INSERT INTO comando_preparacao_projeto VALUES ('a', 1, 'x');
    INSERT INTO fitness_function_projeto VALUES ('a', 'f', 'c', 'd');
    INSERT INTO configuracao_etapa_projeto VALUES ('a', '${etapa0}', NULL, NULL, NULL);
    DELETE FROM projeto WHERE nome = 'a';`);
  for (const t of TABELAS) {
    const restantes = linhas(banco, t);
    assert.ok(
      restantes.every((l) => l.projeto === "b"),
      t,
    );
  }
  assert.equal(linhas(banco, "glob_e2e").length, 1);
});

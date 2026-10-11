import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { Etapa, Fase, TipoId } from "../dominio/primitivos.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abrir, escrever, migrar, novoId } from "./banco.ts";
import { listaSql, MIGRACOES } from "./migracoes.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-banco-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const raizTemp = () => mkdtempSync(join(base, "raiz-"));
const permissao = (caminho: string) => statSync(caminho).mode & 0o777;
const valor = (banco: DatabaseSync, sql: string): unknown => Object.values(banco.prepare(sql).get() ?? {})[0];

/** Roda `trabalho` com as variáveis de ambiente trocadas (`undefined` remove) e restaura as originais. */
function comAmbiente<T>(variaveis: Record<string, string | undefined>, trabalho: () => T): T {
  const originais = Object.fromEntries(Object.keys(variaveis).map((nome) => [nome, process.env[nome]]));
  const aplicar = (valores: Record<string, string | undefined>) => {
    for (const [nome, v] of Object.entries(valores)) {
      if (v === undefined) Reflect.deleteProperty(process.env, nome);
      else process.env[nome] = v;
    }
  };
  aplicar(variaveis);
  try {
    return trabalho();
  } finally {
    aplicar(originais);
  }
}

test("abrir() usa $FABRIQUINHA_ROOT, com diretório 0700 e banco, -wal e -shm 0600", () => {
  const raiz = join(raizTemp(), "aninhada", "fabriquinha");
  const banco = comAmbiente({ FABRIQUINHA_ROOT: raiz }, () => abrir());
  escrever(banco, () => novoId(banco, "issue"));

  assert.equal(permissao(raiz), 0o700);
  for (const arquivo of ["fabriquinha.db", "fabriquinha.db-wal", "fabriquinha.db-shm"]) {
    assert.equal(permissao(join(raiz, arquivo)), 0o600, arquivo);
  }
  banco.close();
});

test("abrir() sem $FABRIQUINHA_ROOT usa ~/fabriquinha", () => {
  const home = raizTemp();
  comAmbiente({ HOME: home, FABRIQUINHA_ROOT: undefined }, () => {
    abrir().close();
  });
  assert.ok(statSync(join(home, "fabriquinha", "fabriquinha.db")).isFile());
});

test("abrir() corrige a permissão de raiz e banco que já existiam abertos demais", () => {
  const raiz = raizTemp();
  abrir(raiz).close();
  chmodSync(raiz, 0o755);
  chmodSync(join(raiz, "fabriquinha.db"), 0o644);
  abrir(raiz).close();
  assert.equal(permissao(raiz), 0o700);
  assert.equal(permissao(join(raiz, "fabriquinha.db")), 0o600);
});

test("toda conexão aplica WAL, foreign_keys, busy_timeout=5000 e synchronous=NORMAL", () => {
  const raiz = raizTemp();
  for (const banco of [abrir(raiz), abrir(raiz)]) {
    assert.equal(valor(banco, "PRAGMA journal_mode"), "wal");
    assert.equal(valor(banco, "PRAGMA foreign_keys"), 1);
    assert.equal(valor(banco, "PRAGMA busy_timeout"), 5000);
    assert.equal(valor(banco, "PRAGMA synchronous"), 1); // NORMAL
    banco.close();
  }
});

test("abrir() aplica as migrações e grava a versão; reabrir não reaplica", () => {
  const raiz = raizTemp();
  abrir(raiz).close();
  const banco = abrir(raiz); // CREATE TABLE sem IF NOT EXISTS: reaplicar falharia
  assert.equal(valor(banco, "PRAGMA user_version"), MIGRACOES.length);
  assert.equal(valor(banco, "SELECT count(*) FROM sequencia"), 0);
  banco.close();
});

test("abrir() propaga a falha de migração sem deixar a versão avançar", () => {
  const raiz = raizTemp();
  abrir(raiz).close();
  const direto = new DatabaseSync(join(raiz, "fabriquinha.db"));
  direto.exec("PRAGMA user_version = 0"); // a tabela já existe: a migração 1 vai falhar
  assert.throws(() => abrir(raiz), /table sequencia already exists/);
  assert.equal(valor(direto, "PRAGMA user_version"), 0);
  direto.close();
});

test("migrar() aplica em ordem só as pendentes, cada uma na sua transação", () => {
  const banco = new DatabaseSync(":memory:");
  const v1 = "CREATE TABLE a (x INTEGER)";
  const v2 = "INSERT INTO a VALUES (2)";
  migrar(banco, [v1]);
  migrar(banco, [v1, v2]);
  migrar(banco, [v1, v2]);
  assert.equal(valor(banco, "PRAGMA user_version"), 2);
  assert.deepEqual(
    banco
      .prepare("SELECT x FROM a")
      .all()
      .map((linha) => linha.x),
    [2],
  );

  const quebrada = "CREATE TABLE b (x INTEGER); INSERT INTO nao_existe VALUES (1)";
  assert.throws(() => {
    migrar(banco, [v1, v2, quebrada]);
  }, /no such table: nao_existe/);
  assert.equal(valor(banco, "PRAGMA user_version"), 2);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master WHERE name = 'b'"), 0);
  banco.close();
});

test("migrar() recusa banco mais novo que o código, sem alterá-lo", () => {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA user_version = 3");
  assert.throws(
    () => {
      migrar(banco, ["CREATE TABLE a (x INTEGER)", "CREATE TABLE b (x INTEGER)"]);
    },
    (erro) =>
      erro instanceof ErroDeRegra &&
      erro.message ===
        "o banco está na versão 3, mais nova que a 2 que esta Fabriquinha conhece (atualize a Fabriquinha antes de abrir este banco)",
  );
  assert.equal(valor(banco, "PRAGMA user_version"), 3);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master"), 0);
  banco.close();
});

test("as listas dos CHECK ... IN (...) vêm dos enums zod", () => {
  assert.equal(listaSql(Etapa), "'registro','desenho','desenvolvimento','revisao','encerramento','sessao'");
  assert.equal(listaSql(Fase).split(",").length, Fase.options.length);

  const banco = abrir(raizTemp());
  assert.match(
    String(valor(banco, "SELECT sql FROM sqlite_master WHERE name = 'sequencia'")),
    new RegExp(listaSql(TipoId)),
  );
  assert.throws(() => {
    banco.exec("INSERT INTO sequencia VALUES ('projeto', 0)");
  }, /CHECK constraint failed/);
  banco.close();
});

test("escrever() pega o lock de escrita no início (BEGIN IMMEDIATE)", () => {
  const raiz = raizTemp();
  const banco = abrir(raiz);
  const outro = abrir(raiz);
  outro.exec("PRAGMA busy_timeout = 0");
  escrever(banco, () => {
    // Ainda nada foi escrito; com BEGIN DEFERRED a outra conexão conseguiria o lock.
    assert.throws(() => {
      outro.exec("BEGIN IMMEDIATE");
    }, /database is locked/);
  });
  outro.exec("BEGIN IMMEDIATE; ROLLBACK");
  banco.close();
  outro.close();
});

test("escrever() faz ROLLBACK e propaga o erro original", () => {
  const banco = abrir(raizTemp());
  const original = new Error("falhou no meio");
  assert.throws(
    () =>
      escrever(banco, () => {
        novoId(banco, "issue");
        throw original;
      }),
    (erro) => erro === original,
  );
  assert.equal(banco.isTransaction, false);
  assert.equal(
    escrever(banco, () => novoId(banco, "issue")),
    1,
  );
  banco.close();
});

test("escrever() desfaz e propaga quando o próprio COMMIT falha", () => {
  const banco = abrir(raizTemp());
  banco.exec(
    "CREATE TABLE pai (id INTEGER PRIMARY KEY); CREATE TABLE filho (pai INTEGER REFERENCES pai(id) DEFERRABLE INITIALLY DEFERRED)",
  );
  assert.throws(() => {
    escrever(banco, () => {
      banco.exec("INSERT INTO filho VALUES (99)");
    });
  }, /FOREIGN KEY constraint failed/);
  assert.equal(banco.isTransaction, false);
  assert.equal(valor(banco, "SELECT count(*) FROM filho"), 0);
  banco.close();
});

test("novoId() tem uma sequência por tipo e só roda dentro da transação", () => {
  const banco = abrir(raizTemp());
  const ids = escrever(banco, () => [novoId(banco, "issue"), novoId(banco, "ticket"), novoId(banco, "issue")]);
  assert.deepEqual(ids, [1, 1, 2]);
  assert.equal(
    escrever(banco, () => novoId(banco, "ticket")),
    2,
  );
  assert.throws(() => novoId(banco, "issue"), /fora de transação/);
  banco.close();
});

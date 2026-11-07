import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { migrar } from "./banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

/**
 * O `sqlite_master` inteiro (tabelas, índices, CHECK e os itens internos `sqlite_*`) de um banco criado pela cadeia de
 * migrações 1 a 36, capturado antes de ela ser apagada. Em 2026-11-06 foi conferido que a linha de base gera o mesmo
 * conteúdo do banco criado pela cadeia: 100 itens, 0 diferenças.
 */
const ESQUEMA_DA_CADEIA_1_A_36 = JSON.parse(
  readFileSync(new URL("linha_de_base_v36.snapshot.json", import.meta.url), "utf8"),
) as unknown[];

const versao = (banco: DatabaseSync) => banco.prepare("PRAGMA user_version").get()?.user_version;
const esquema = (banco: DatabaseSync) =>
  banco
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name")
    .all()
    .map((linha) => ({ ...linha }));

test("CA-4: o banco vazio nasce da linha de base com o mesmo sqlite_master da cadeia 1-36, vazio de dados e com FKs íntegras", () => {
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES);
  assert.equal(versao(banco), VERSAO_LINHA_DE_BASE);
  assert.deepEqual(esquema(banco), ESQUEMA_DA_CADEIA_1_A_36);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM configuracao").get()?.n, 1);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM sequencia").get()?.n, 0);
  banco.close();
});

test("CA-5: o banco em v36 sobe sem aplicar migração e sem alteração", () => {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  banco.exec("UPDATE configuracao SET intervalo_min = 7");
  migrar(banco, []);
  assert.equal(versao(banco), VERSAO_LINHA_DE_BASE);
  assert.equal(banco.prepare("SELECT intervalo_min AS n FROM configuracao").get()?.n, 7);
  banco.close();
});

test("CA-5: o banco em v35 é recusado, com orientação, sem alteração", () => {
  const banco = new DatabaseSync(":memory:");
  banco.exec("CREATE TABLE antigo (x INTEGER); PRAGMA user_version = 35");
  assert.throws(
    () => {
      migrar(banco, MIGRACOES);
    },
    (erro) =>
      erro instanceof ErroDeRegra &&
      erro.message.includes("o banco está na versão 35, anterior à 36") &&
      erro.message.includes("suba a Fabriquinha da versão anterior à linha de base (I-263)"),
  );
  assert.equal(versao(banco), 35);
  assert.deepEqual(
    banco
      .prepare("SELECT name FROM sqlite_master")
      .all()
      .map((linha) => linha.name),
    ["antigo"],
  );
  banco.close();
});

test("as migrações novas, em SQL ou em função, seguem a linha de base a partir da 37", () => {
  const banco = new DatabaseSync(":memory:");
  const emSql = "CREATE TABLE nova (x INTEGER)";
  migrar(banco, [emSql]);
  assert.equal(versao(banco), 37);
  migrar(banco, [
    emSql,
    (b) => {
      b.exec("INSERT INTO nova VALUES (1)");
    },
  ]);
  assert.equal(versao(banco), 38);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM nova").get()?.n, 1);
  banco.close();
});

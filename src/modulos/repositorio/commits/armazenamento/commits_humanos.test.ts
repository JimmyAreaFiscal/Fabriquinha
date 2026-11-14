import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { cursorDaBase, gravarVarredura, projetosAVarrer } from "./commits_humanos.ts";
import { migrarBancoDaFabriquinha } from "../../../../server/system/banco_da_fabriquinha.ts";

test("projetosAVarrer: os sem varredura e os varridos há mais de 24 horas, em ordem de nome", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);
  for (const nome of ["loja", "velho", "novo"]) {
    banco
      .prepare(
        `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
         VALUES (?, ?, 'main', 'github', ?)`,
      )
      .run(nome, `/repo/${nome}`, nome);
  }
  const relogio = relogioFixo("2026-10-11T12:00:00.000Z");
  const varrido = (projeto: string, em: string) =>
    banco
      .prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES (?, ?, ?)")
      .run(projeto, "a".repeat(40), em);
  varrido("velho", "2026-10-10T11:59:59.999Z");
  varrido("novo", "2026-10-10T12:00:00.000Z");

  assert.deepEqual(projetosAVarrer(banco, ["velho", "novo", "loja"], relogio), ["loja", "velho"]);
  banco.close();
});

test("gravarVarredura grava o cursor com a hora do Relogio injetado", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);
  banco
    .prepare(
      `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
       VALUES ('loja', '/repo/loja', 'main', 'github', 'loja')`,
    )
    .run();

  gravarVarredura(banco, "loja", "b".repeat(40), [], relogioFixo("2026-10-11T12:00:00.000Z"));

  assert.equal(cursorDaBase(banco, "loja"), "b".repeat(40));
  assert.equal(
    (banco.prepare("SELECT em FROM varredura_base WHERE projeto = 'loja'").get() as { em: string }).em,
    "2026-10-11T12:00:00.000Z",
  );
  banco.close();
});

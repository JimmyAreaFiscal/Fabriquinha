import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { projetosAVarrer } from "./commits_humanos.ts";
import { MIGRACOES } from "./migracoes.ts";

test("projetosAVarrer: os sem varredura e os varridos há mais de 24 horas, em ordem de nome", () => {
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES);
  for (const nome of ["loja", "velho", "novo"]) {
    banco
      .prepare(
        `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
         VALUES (?, ?, 'main', 'github', ?)`,
      )
      .run(nome, `/repo/${nome}`, nome);
  }
  const agora = new Date("2026-10-11T12:00:00.000Z");
  const varrido = (projeto: string, em: string) =>
    banco
      .prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES (?, ?, ?)")
      .run(projeto, "a".repeat(40), em);
  varrido("velho", "2026-10-10T11:59:59.999Z");
  varrido("novo", "2026-10-10T12:00:00.000Z");

  assert.deepEqual(projetosAVarrer(banco, agora), ["loja", "velho"]);
  banco.close();
});

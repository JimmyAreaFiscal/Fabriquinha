import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { montarRepositorio } from "./repositorio_do_projeto.ts";

test("sem a varredura, o Repositório não lê o banco em segundo plano e parar resolve na hora", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // O banco sem tabelas: qualquer leitura da varredura lançaria.
  const repositorio = montarRepositorio({ banco: new DatabaseSync(":memory:") });
  t.mock.timers.tick(60_000);
  await assert.doesNotReject(repositorio.parar());
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { espacoDaRodada } from "../nucleo/espaco_de_trabalho.ts";
import { ocupanteDoAmbiente } from "./ambiente_do_espaco.ts";

test("ocupanteDoAmbiente: o dono por extenso e a pasta das worktrees do projeto, não a da demanda", () => {
  assert.deepEqual(ocupanteDoAmbiente(espacoDaRodada({ nome: "loja" }, "I-1", 2, "/r"), "/r", "loja"), {
    dono: "I-1.R2",
    pasta_das_worktrees_do_projeto: "/r/worktrees/loja",
  });
});

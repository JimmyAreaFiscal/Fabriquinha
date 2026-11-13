import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeReprovacao, ErroExterno } from "../../../../shared/nucleo/erros.ts";
import { HooksDoCommit } from "./hooks_do_commit.ts";
import { AmbienteHostLocal } from "../../../ambiente/publico.ts";

const contexto = { ambiente: new AmbienteHostLocal(), worktree: "/tmp/worktree" };

test("o commit que passa é 'passou', sem relatório, e recebe o contexto", async () => {
  const recebidos: unknown[] = [];
  const hooks = new HooksDoCommit((c) => {
    recebidos.push(c);
    return Promise.resolve("sha");
  });

  assert.equal(hooks.tipo, "hooks_do_commit");
  assert.deepEqual(await hooks.executar(contexto), { tipo: "passou" });
  assert.deepEqual(recebidos, [contexto]);
});

test("o hook que reprova o commit é reprovação com a saída; o que estoura o tempo é falha de infraestrutura", async () => {
  const reprovado = new HooksDoCommit(() => Promise.reject(new ErroDeReprovacao("lint quebrou", "corrija")));
  assert.deepEqual(await reprovado.executar(contexto), {
    tipo: "reprovacao",
    motivo: "lint quebrou (corrija)",
    log: "",
  });

  const travado = new HooksDoCommit(() => Promise.reject(new ErroExterno("passou do limite", "tente de novo")));
  assert.deepEqual(await travado.executar(contexto), {
    tipo: "falha_infraestrutura",
    causa: "servico_externo_inacessivel",
    motivo: "falha de infraestrutura: passou do limite (tente de novo)",
  });
});

test("outro erro propaga", async () => {
  const hooks = new HooksDoCommit(() => Promise.reject(new Error("disco cheio")));

  await assert.rejects(hooks.executar(contexto), /disco cheio/);
});

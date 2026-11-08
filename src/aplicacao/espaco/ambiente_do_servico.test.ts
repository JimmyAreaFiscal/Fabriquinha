import assert from "node:assert/strict";
import { test } from "node:test";
import { AmbienteHostLocal } from "../../infra/ambiente/ambiente_host_local.ts";
import { ambienteDoServico, montarAmbienteDoServico } from "./ambiente_do_servico.ts";

test("sem montagem vale o host local, e o que a composição monta passa a valer", () => {
  assert.ok(ambienteDoServico() instanceof AmbienteHostLocal);
  const montado = new AmbienteHostLocal();
  montarAmbienteDoServico(montado);
  assert.equal(ambienteDoServico(), montado);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { AmbienteHostLocal } from "../../infra/ambiente/ambiente_host_local.ts";
import type { ConjuntoDeAmbientes } from "../ambiente/conjunto.ts";
import {
  ambienteDoServico,
  conjuntoDoServico,
  montarAmbienteDoServico,
  montarConjuntoDoServico,
} from "./ambiente_do_servico.ts";

test("sem montagem vale o host local, e o que a composição monta passa a valer", () => {
  assert.ok(ambienteDoServico() instanceof AmbienteHostLocal);
  const montado = new AmbienteHostLocal();
  montarAmbienteDoServico(montado);
  assert.equal(ambienteDoServico(), montado);
});

test("sem montagem não há conjunto, e o que a composição monta é perguntado a cada vez", () => {
  assert.equal(conjuntoDoServico(), undefined);
  const montado = {} as ConjuntoDeAmbientes;
  montarConjuntoDoServico(() => montado);
  assert.equal(conjuntoDoServico(), montado);
  montarConjuntoDoServico(() => undefined);
});

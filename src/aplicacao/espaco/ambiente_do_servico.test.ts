import assert from "node:assert/strict";
import { test } from "node:test";
import { AmbienteHostLocal } from "../../infra/ambiente/ambiente_host_local.ts";
import type { AmbienteContainer } from "../../infra/ambiente/container/ambiente_container.ts";
import type { EspacoDeTrabalho } from "../../nucleo/espaco_de_trabalho.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import type { ConjuntoDeAmbientes } from "../ambiente/conjunto.ts";
import {
  ambienteDoEspaco,
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

test("ambienteDoEspaco devolve o container alocado ao Espaço e, sem ele, o Ambiente do serviço", () => {
  const espaco = { dono: Endereco.daDemanda("I-1") } as EspacoDeTrabalho;
  const doServico = ambienteDoServico();
  assert.equal(ambienteDoEspaco(espaco), doServico);
  const container = {} as AmbienteContainer;
  const alocado: { ambiente?: AmbienteContainer } = {};
  montarConjuntoDoServico(() => ({ ambienteAlocadoPara: () => alocado.ambiente }) as unknown as ConjuntoDeAmbientes);
  assert.equal(ambienteDoEspaco(espaco), doServico);
  alocado.ambiente = container;
  assert.equal(ambienteDoEspaco(espaco), container);
  montarConjuntoDoServico(() => undefined);
});

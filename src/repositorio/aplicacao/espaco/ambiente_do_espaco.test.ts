import assert from "node:assert/strict";
import { test } from "node:test";
import type { AmbienteContainer } from "../../../sandbox/infra/container/ambiente_container.ts";
import type { ConjuntoDeAmbientes } from "../../../sandbox/aplicacao/conjunto_de_ambientes/conjunto.ts";
import { ambienteDoServico, montarConjuntoDoServico } from "../../../sandbox/aplicacao/ambiente_do_servico.ts";
import { Endereco } from "../../../sdlc/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { type EspacoDeTrabalho, espacoDaRodada } from "../../nucleo/espaco_de_trabalho.ts";
import { ambienteDoEspaco, ocupanteDoAmbiente } from "./ambiente_do_espaco.ts";

test("ocupanteDoAmbiente: o dono por extenso e a pasta das worktrees do projeto, não a da demanda", () => {
  assert.deepEqual(ocupanteDoAmbiente(espacoDaRodada({ nome: "loja" }, "I-1", 2, "/r"), "/r", "loja"), {
    dono: "I-1.R2",
    pasta_das_worktrees_do_projeto: "/r/worktrees/loja",
  });
});

test("ambienteDoEspaco devolve o Ambiente alocado ao Espaço e, sem ele, o Ambiente do serviço", () => {
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

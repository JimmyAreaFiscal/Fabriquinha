import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ambiente, GestaoDeAmbientes } from "../../../ambiente/publico.ts";
import { type EspacoDeTrabalho, espacoDaRodada } from "../nucleo/espaco_de_trabalho.ts";
import {
  ambienteDoEspaco,
  gestaoDeAmbientes,
  ligarGestaoDeAmbientes,
  ocupanteDoAmbiente,
} from "./ambiente_do_espaco.ts";

test("ocupanteDoAmbiente: o dono por extenso e a pasta das worktrees do projeto, não a da demanda", () => {
  assert.deepEqual(ocupanteDoAmbiente(espacoDaRodada({ nome: "loja" }, "I-1", 2, "/r"), "/r", "loja"), {
    dono: "I-1.R2",
    pasta_das_worktrees_do_projeto: "/r/worktrees/loja",
  });
});

test("ambienteDoEspaco pergunta à gestão ligada pelo Ambiente do dono do Espaço; sem gestão ligada, recusa", () => {
  const ligadaAntes = gestaoDeAmbientes();
  const espaco = { dono: { demanda_id: "I-1", rodada_id: 2 } } as EspacoDeTrabalho;
  const container = { id: "amb-1" } as Ambiente;
  const perguntados: (string | undefined)[] = [];
  ligarGestaoDeAmbientes({
    ambienteDo: (ocupante) => {
      perguntados.push(ocupante);
      return container;
    },
  } as GestaoDeAmbientes);
  try {
    assert.equal(ambienteDoEspaco(espaco), container);
    assert.deepEqual(perguntados, ["I-1.R2"]);
    ligarGestaoDeAmbientes(undefined as unknown as GestaoDeAmbientes);
    assert.throws(() => ambienteDoEspaco(espaco), /o Repositório não tem a gestão de Ambientes/);
  } finally {
    ligarGestaoDeAmbientes(ligadaAntes);
  }
});

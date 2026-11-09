// A base das conduções: o endereço que ela aceita (os passos da condução determinística são cobertos pela `ConducaoDeEncerrarDemanda`).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { anotar } from "../../infra/registro.ts";
import { cenarioRevisao } from "../../../apoio-testes/cenarios_de_demanda.ts";
import { instanteAtual } from "../relogio.ts";
import { condutor } from "../trabalho/condutor.ts";
import { ConducaoDeRevisarDemanda } from "./conducao_de_revisar_demanda.ts";

test("só se conduz o endereço de um ticket", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const conducao = new ConducaoDeRevisarDemanda({ banco, relogio: instanteAtual, condutor, registro: anotar });
  await assert.rejects(conducao.conduzir(Endereco.daRodada("I-1", 1)), /I-1.R1 não é um ticket/);
});

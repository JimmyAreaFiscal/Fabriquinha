import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDaDemanda } from "../../../apoio-testes/banco_de_metricas.ts";
import { ErroDeInexistente } from "../../compartilhado/nucleo/erros.ts";
import type { DefinicaoDaMetrica } from "../nucleo/metrica.ts";
import { MetricaDoSdlc, MetricaPorEtapa } from "./calculo_de_metrica.ts";
import { MetricaDeUso } from "./metricas/metrica_de_uso.ts";

class MetricaDeTeste extends MetricaPorEtapa<string> {
  readonly definicao: DefinicaoDaMetrica = { tipo: "nota_humana", rotulo: "Teste", fonte: "Teste" };

  protected medir() {
    return (etapa: string) => `valor de ${etapa}`;
  }
}

class MetricaDoSdlcDeTeste extends MetricaDoSdlc<"teste", string> {
  readonly definicao = { tipo: "teste", rotulo: "Teste", fonte: "Teste" } as const;

  protected medir() {
    return "valor do SDLC";
  }
}

test("o tipo vem da definição, e o cálculo devolve só as Etapas que o catálogo diz que declaram o tipo", () => {
  const metrica = new MetricaDeTeste();
  assert.equal(metrica.tipo, "nota_humana");
  assert.deepEqual([...metrica.calcular(bancoDaDemanda(), {})], [["encerrar_rodada", "valor de encerrar_rodada"]]);
  assert.equal(new MetricaDeUso().calcular(bancoDaDemanda(), {}).size, 9);
});

test("CA-17: demanda inexistente falha, sem totais zerados", () => {
  assert.throws(() => new MetricaDeTeste().calcular(bancoDaDemanda(), { demandaId: "I-9" }), ErroDeInexistente);
  assert.throws(() => new MetricaDeUso().calcular(bancoDaDemanda(), { demandaId: "I-9" }), ErroDeInexistente);
  assert.throws(() => new MetricaDoSdlcDeTeste().calcular(bancoDaDemanda(), { demandaId: "I-9" }), ErroDeInexistente);
});

test("a Métrica do SDLC devolve um valor só para o recorte, sem Etapa", () => {
  assert.equal(new MetricaDoSdlcDeTeste().calcular(bancoDaDemanda(), {}), "valor do SDLC");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDaDemanda, origemDe } from "../../../../../apoio-testes/banco/banco_de_metricas.ts";
import { ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import type { DefinicaoDaMetrica } from "../nucleo/metrica.ts";
import { MetricaDoSdlc, MetricaPorEtapa } from "./calculo_de_metrica.ts";
import { MetricaDeUso } from "./metricas/metrica_de_uso.ts";

class MetricaDeTeste extends MetricaPorEtapa<string, string> {
  readonly definicao: DefinicaoDaMetrica = { tipo: "nota_humana", rotulo: "Teste", fonte: "Teste" };

  protected lerFatos() {
    return "valor";
  }

  formula(fatos: string) {
    return (etapa: string) => `${fatos} de ${etapa}`;
  }
}

class MetricaDoSdlcDeTeste extends MetricaDoSdlc<"teste", number[], string> {
  readonly definicao = { tipo: "teste", rotulo: "Teste", fonte: "Teste" } as const;

  protected lerFatos() {
    return [1, 2];
  }

  formula(fatos: number[]) {
    return `valor do SDLC com ${String(fatos.length)} fatos`;
  }
}

test("o tipo vem da definição, e o cálculo devolve só as Etapas que o catálogo diz que declaram o tipo", () => {
  const metrica = new MetricaDeTeste();
  assert.equal(metrica.tipo, "nota_humana");
  assert.deepEqual(
    [...metrica.calcular(origemDe(bancoDaDemanda()), {})],
    [["encerrar_rodada", "valor de encerrar_rodada"]],
  );
  assert.equal(new MetricaDeUso().calcular(origemDe(bancoDaDemanda()), {}).size, 9);
});

test("CA-17: demanda inexistente falha, sem totais zerados", () => {
  assert.throws(
    () => new MetricaDeTeste().calcular(origemDe(bancoDaDemanda()), { demandaId: "I-9" }),
    ErroDeInexistente,
  );
  assert.throws(() => new MetricaDeUso().calcular(origemDe(bancoDaDemanda()), { demandaId: "I-9" }), ErroDeInexistente);
  assert.throws(
    () => new MetricaDoSdlcDeTeste().calcular(origemDe(bancoDaDemanda()), { demandaId: "I-9" }),
    ErroDeInexistente,
  );
});

test("a fórmula é pura: deriva o valor dos fatos sem ler o banco", () => {
  assert.equal(new MetricaDeTeste().formula("fato")("planejar"), "fato de planejar");
  assert.equal(new MetricaDoSdlcDeTeste().formula([]), "valor do SDLC com 0 fatos");
});

test("a Métrica do SDLC devolve um valor só para o recorte, sem Etapa", () => {
  assert.equal(new MetricaDoSdlcDeTeste().calcular(origemDe(bancoDaDemanda()), {}), "valor do SDLC com 2 fatos");
});

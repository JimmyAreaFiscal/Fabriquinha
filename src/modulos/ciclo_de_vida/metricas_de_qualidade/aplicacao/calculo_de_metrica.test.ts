import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDaDemanda, origemDe } from "../../../../../apoio-testes/banco/banco_de_metricas.ts";
import { ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import type { DefinicaoDaMetrica } from "../nucleo/metrica.ts";
import { DEMANDA_DO_FATO, type FatoDatado, MetricaDoSdlc, MetricaPorEtapa } from "./calculo_de_metrica.ts";
import { escopoDoRecorte } from "./leitura_dos_fatos.ts";
import { MetricaDeExigenciasDeAlteracao } from "./metricas/metrica_de_exigencias_de_alteracao.ts";

interface FatosDeTeste {
  fatos: FatoDatado[];
  outros: FatoDatado[];
}

const FATOS_DE_TESTE: FatosDeTeste = {
  fatos: [
    { demanda_id: "I-1", em: "2026-01-01T00:00:00.000Z" },
    { demanda_id: "I-2", em: "2026-01-02T00:00:00.000Z" },
    { demanda_id: "I-1", em: "2026-01-03T00:00:00.000Z" },
  ],
  outros: [{ demanda_id: "I-2", em: "2026-01-04T00:00:00.000Z" }],
};

class MetricaDeTeste extends MetricaPorEtapa<FatosDeTeste, string> {
  readonly definicao: DefinicaoDaMetrica = { tipo: "nota_humana", rotulo: "Teste", fonte: "Teste" };
  leituras = 0;

  protected lerFatos() {
    this.leituras++;
    return FATOS_DE_TESTE;
  }

  formula({ fatos, outros }: FatosDeTeste) {
    return (etapa: string) =>
      `${fatos.map((fato) => fato.em.slice(8, 10)).join(",")}|${String(outros.length)} de ${etapa}`;
  }
}

class MetricaDoSdlcDeTeste extends MetricaDoSdlc<"teste", FatosDeTeste, string> {
  readonly definicao = { tipo: "teste", rotulo: "Teste", fonte: "Teste" } as const;

  protected lerFatos() {
    return FATOS_DE_TESTE;
  }

  formula({ fatos }: FatosDeTeste) {
    return `valor do SDLC com ${String(fatos.length)} fatos`;
  }
}

test("o tipo vem da definição, e o cálculo devolve só as Etapas que o catálogo diz que declaram o tipo", () => {
  const metrica = new MetricaDeTeste();
  assert.equal(metrica.tipo, "nota_humana");
  assert.deepEqual(
    [...metrica.calcular(origemDe(bancoDaDemanda()), {})],
    [["encerrar_rodada", "01,02,03|1 de encerrar_rodada"]],
  );
  assert.equal(new MetricaDeExigenciasDeAlteracao().calcular(origemDe(bancoDaDemanda()), {}).size, 2);
});

test("CA-17: demanda inexistente falha, sem totais zerados", () => {
  assert.throws(
    () => new MetricaDeTeste().calcular(origemDe(bancoDaDemanda()), { demandaId: "I-9" }),
    ErroDeInexistente,
  );
  assert.throws(
    () => new MetricaDeExigenciasDeAlteracao().calcular(origemDe(bancoDaDemanda()), { demandaId: "I-9" }),
    ErroDeInexistente,
  );
  assert.throws(
    () => new MetricaDoSdlcDeTeste().calcular(origemDe(bancoDaDemanda()), { demandaId: "I-9" }),
    ErroDeInexistente,
  );
});

test("a fórmula é pura: deriva o valor dos fatos sem ler o banco", () => {
  assert.equal(new MetricaDeTeste().formula({ fatos: [], outros: [] })("planejar"), "|0 de planejar");
  assert.equal(new MetricaDoSdlcDeTeste().formula({ fatos: [], outros: [] }), "valor do SDLC com 0 fatos");
});

test("a Métrica do SDLC devolve um valor só para o recorte, sem Etapa", () => {
  assert.equal(new MetricaDoSdlcDeTeste().calcular(origemDe(bancoDaDemanda()), {}), "valor do SDLC com 3 fatos");
});

test("por parte, os fatos são lidos uma vez e cada parte aplica a fórmula só aos dela, na ordem lida", () => {
  const metrica = new MetricaDeTeste();
  const porDemanda = metrica.calcularPorParte(escopoDoRecorte(origemDe(bancoDaDemanda()), {}), DEMANDA_DO_FATO);
  assert.deepEqual(
    [porDemanda.daParte("I-1"), porDemanda.daParte("I-2"), porDemanda.daParte("I-9"), porDemanda.doRecorte()].map(
      (valores) => valores.get("encerrar_rodada"),
    ),
    ["01,03|0 de encerrar_rodada", "02|1 de encerrar_rodada", "|0 de encerrar_rodada", "01,02,03|1 de encerrar_rodada"],
  );
  assert.equal(metrica.leituras, 1);
  const sdlcPorDia = new MetricaDoSdlcDeTeste().calcularPorParte(
    escopoDoRecorte(origemDe(bancoDaDemanda()), {}),
    (fato) => fato.em.slice(0, 10),
  );
  assert.equal(sdlcPorDia.daParte("2026-01-02"), "valor do SDLC com 1 fatos");
});

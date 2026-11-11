import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bancoDoPeriodo,
  doMes,
  em,
  gravarDecisaoEm,
  gravarTicket,
} from "../../../../apoio-testes/banco_de_metricas.ts";
import { ErroDeInexistente } from "../../../compartilhado/nucleo/erros.ts";
import { CATALOGO_DE_ETAPAS } from "../../../fluxo/nucleo/etapa.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import { metricasDasEtapas } from "./metricas_das_etapas.ts";

const valorDe = (metricas: ReturnType<typeof metricasDasEtapas>, etapa: EtapaTicket, tipo: string) =>
  metricas.get(etapa)?.find((m) => m.definicao.tipo === tipo)?.valor;

test("cada Etapa traz as Métricas que o catálogo declara para ela, com rótulo e fonte", () => {
  const metricas = metricasDasEtapas(bancoDoPeriodo(), {});
  assert.deepEqual([...metricas.keys()], EtapaTicket.options);
  for (const etapa of EtapaTicket.options) {
    assert.deepEqual(
      metricas.get(etapa)?.map((m) => m.definicao.tipo),
      CATALOGO_DE_ETAPAS[etapa].metricas,
      etapa,
    );
  }
  assert.ok(metricas.get("planejar")?.every((m) => m.definicao.rotulo !== "" && m.definicao.fonte !== ""));
});

test("fatos do mês: demandas, tickets, PRs, notas, reprovações por etapa e alterações posteriores", () => {
  const b = bancoDoPeriodo();
  gravarTicket(b, "I-1", 7, "revisar_rodada", 1);
  gravarDecisaoEm(b, ["I-1", 7, 1], ["gate_revisao_rodada", "reprovado", null], em("2026-02"));
  const [jan, fev, mar] = ["2026-01", "2026-02", "2026-03"].map((mes) => metricasDasEtapas(b, doMes(mes)));
  assert.ok(jan && fev && mar);
  assert.deepEqual(valorDe(fev, "encerrar_rodada", "nota_humana"), { soma: 9, quantidade: 2, media: 4.5 });
  assert.deepEqual(valorDe(jan, "encerrar_rodada", "nota_humana"), { soma: 0, quantidade: 0, media: null });
  assert.deepEqual(valorDe(fev, "revisar_rodada", "exigencias_de_alteracao"), { reprovacoes: 1 });
  assert.deepEqual(valorDe(mar, "revisar_rodada", "exigencias_de_alteracao"), { reprovacoes: 0 });
  assert.deepEqual(valorDe(fev, "implementar", "alteracoes_posteriores"), { adicionadas: 30, alteradasPorHumanos: 5 });
  assert.deepEqual(valorDe(mar, "implementar", "alteracoes_posteriores"), { adicionadas: 0, alteradasPorHumanos: 0 });
});

test("o recorte de período, de Projeto e de Demanda valem para todas as Métricas", () => {
  const b = bancoDoPeriodo();
  const execucoesDeImplementar = (recorte: Recorte) =>
    (valorDe(metricasDasEtapas(b, recorte), "implementar", "uso") as { execucoes: number }).execucoes;
  assert.equal(execucoesDeImplementar(doMes("2026-02")), 2);
  assert.equal(execucoesDeImplementar({ projeto: "site" }), 1);
  assert.equal(execucoesDeImplementar({ demandaId: "I-1" }), 3);
  assert.throws(() => metricasDasEtapas(b, { demandaId: "I-9" }), ErroDeInexistente);
});

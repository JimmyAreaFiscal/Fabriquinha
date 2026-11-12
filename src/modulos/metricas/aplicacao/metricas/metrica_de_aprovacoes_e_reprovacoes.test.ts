import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bancoDoPeriodo,
  doMes,
  em,
  gravarDecisaoEm,
  gravarTicket,
} from "../../../../../apoio-testes/banco_de_metricas.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { MetricaDeAprovacoesEReprovacoes } from "./metrica_de_aprovacoes_e_reprovacoes.ts";

/** O período tem duas Decisões do Gate da demanda em I-1 (reprovada em fevereiro, aprovada em março) e uma aprovada em I-3. */
const banco = () => {
  const b = bancoDoPeriodo();
  gravarTicket(b, "I-1", 9, "entender_e_desenhar", null);
  gravarTicket(b, "I-3", 9, "entender_e_desenhar", null);
  gravarDecisaoEm(b, ["I-1", 9, 1], ["gate_demanda", "reprovado", null], em("2026-02"));
  gravarDecisaoEm(b, ["I-1", 9, 2], ["gate_demanda", "aprovado", null], em("2026-03"));
  gravarDecisaoEm(b, ["I-3", 9, 1], ["gate_demanda", "aprovado", null], em("2026-03"));
  return b;
};

const doGateDaDemanda = (b: ReturnType<typeof banco>, recorte: Recorte) =>
  new MetricaDeAprovacoesEReprovacoes().calcular(b, recorte).get("entender_e_desenhar");

test("as aprovações e reprovações do Gate da demanda existem só em entender_e_desenhar", () => {
  const valores = new MetricaDeAprovacoesEReprovacoes().calcular(banco(), {});
  assert.deepEqual([...valores.keys()], ["entender_e_desenhar"]);
  assert.deepEqual(new MetricaDeAprovacoesEReprovacoes().definicao, {
    tipo: "aprovacoes_e_reprovacoes",
    rotulo: "Reprovações no Gate",
    fonte: "Gate da demanda",
  });
});

test("o recorte de período conta as Decisões do mês, sem as de outras Etapas", () => {
  const b = banco();
  assert.deepEqual(doGateDaDemanda(b, doMes("2026-02")), { aprovacoes: 0, reprovacoes: 1 }); // a reprovada do implementar não conta
  assert.deepEqual(doGateDaDemanda(b, doMes("2026-03")), { aprovacoes: 2, reprovacoes: 0 });
  assert.deepEqual(doGateDaDemanda(b, doMes("2026-01")), { aprovacoes: 0, reprovacoes: 0 });
});

test("o recorte de Projeto conta as Decisões das demandas dele", () => {
  const b = banco();
  assert.deepEqual(doGateDaDemanda(b, { projeto: "loja" }), { aprovacoes: 1, reprovacoes: 1 });
  assert.deepEqual(doGateDaDemanda(b, { projeto: "site" }), { aprovacoes: 1, reprovacoes: 0 });
});

test("o recorte de Demanda conta as Decisões dela", () => {
  const b = banco();
  assert.deepEqual(doGateDaDemanda(b, { demandaId: "I-1" }), { aprovacoes: 1, reprovacoes: 1 });
  assert.deepEqual(doGateDaDemanda(b, { ...doMes("2026-03"), demandaId: "I-3" }), { aprovacoes: 1, reprovacoes: 0 });
});

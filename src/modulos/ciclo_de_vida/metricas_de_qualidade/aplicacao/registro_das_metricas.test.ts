import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDoPeriodo, doMes, em, origemDe } from "../../../../../apoio-testes/banco/banco_de_metricas.ts";
import { ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import type { Recorte } from "../nucleo/metrica.ts";
import { metricasDoSdlc } from "./registro_das_metricas.ts";

test("as Métricas do SDLC inteiro valem para o recorte de período, de Projeto e de Demanda", () => {
  const b = bancoDoPeriodo();
  const valoresDoSdlc = (recorte: Recorte) =>
    Object.fromEntries(metricasDoSdlc(origemDe(b), recorte).map((m) => [m.definicao.tipo, m.valor]));
  assert.deepEqual(valoresDoSdlc(doMes("2026-02")), {
    demandas: { registradas: 0, concluidas: 0 },
    tickets: { criados: 2, concluidos: 2 },
    prs: { abertos: 1, mergeados: 1 },
  });
  assert.deepEqual(valoresDoSdlc({ demandaId: "I-1" }).demandas, { registradas: 1, concluidas: 0 });
  assert.ok(metricasDoSdlc(origemDe(b), {}).every((m) => m.definicao.rotulo !== "" && m.definicao.fonte !== ""));
  assert.throws(() => metricasDoSdlc(origemDe(b), { demandaId: "I-9" }), ErroDeInexistente);
});

test("PRs: o da rodada migrada (sem ticket) e o da demanda (sem rodada) contam abertos, sem Gate do PR aprovado", () => {
  const b = bancoDoPeriodo();
  b.prepare(
    "INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, tipo, dados, em) VALUES ('e2', 'I-1', 2, 'pr_aberto', '{}', ?)",
  ).run(em("2026-03"));
  b.prepare(
    "INSERT INTO evidencia_demanda (id, demanda_id, tipo, dados, em) VALUES ('e3', 'I-3', 'pr_aberto', '{}', ?)",
  ).run(em("2026-03"));
  const prsDoMes = (mes: string) =>
    metricasDoSdlc(origemDe(b), doMes(mes)).find((m) => m.definicao.tipo === "prs")?.valor;
  assert.deepEqual(prsDoMes("2026-02"), { abertos: 1, mergeados: 1 });
  assert.deepEqual(prsDoMes("2026-03"), { abertos: 2, mergeados: 0 });
});

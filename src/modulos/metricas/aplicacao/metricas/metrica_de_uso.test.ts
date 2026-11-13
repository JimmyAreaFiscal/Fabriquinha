import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bancoDaDemanda,
  bancoDoPeriodo,
  doMes,
  gravarExecucao,
  gravarUsoDeclarado,
  linhaDeUsoDeclarado,
} from "../../../../../apoio-testes/banco_de_metricas.ts";
import { intervalo } from "../../../compartilhado/nucleo/periodo.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../../etapas/catalogo.ts";
import { MetricaDeUso } from "./metrica_de_uso.ts";

const calcularUso = (banco: Parameters<MetricaDeUso["calcular"]>[0], recorte: Recorte) =>
  new MetricaDeUso().calcular(banco, recorte);

const daEtapa = <Valor>(valores: Map<EtapaTicket, Valor>, etapa: EtapaTicket): Valor => {
  const valor = valores.get(etapa);
  assert.ok(valor);
  return valor;
};

/** Execuções, falhas, duração, tokens, custo conhecido e Trabalhos sem custo de todas as Etapas somados. */
const totalDasEtapas = (valores: ReturnType<typeof calcularUso>) => {
  const etapas = [...valores.values()];
  const somar = (valorDaEtapa: (v: (typeof etapas)[number]) => number) =>
    etapas.reduce((total, v) => total + valorDaEtapa(v), 0);
  return [
    somar((v) => v.execucoes),
    somar((v) => v.falhas),
    somar((v) => v.duracaoMs),
    somar((v) => v.tokens.total),
    somar((v) => v.custo.conhecido),
    somar((v) => v.custo.trabalhosSemCusto),
  ];
};
const somarTotais = (a: number[], b: number[]) => a.map((n, i) => n + (b[i] ?? 0));

test("o Uso vale para as nove Etapas, com a definição que a tela mostra", () => {
  const valores = calcularUso(bancoDaDemanda(), { demandaId: "I-1" });
  assert.equal(valores.size, 9);
  assert.deepEqual(new MetricaDeUso().definicao, { tipo: "uso", rotulo: "Uso", fonte: "Uso" });
});

test("CA-1 e CA-18: tokens por modelo na demanda e por etapa, com o custo das execuções", () => {
  const b = bancoDaDemanda();
  gravarExecucao(b, 2, "e1", 0, [["m1", 10, 20, 30, 40, 1]]);
  gravarExecucao(b, 2, "e2", 0, [["m1", 1, 2, 3, 4, 0.5]]);
  gravarExecucao(b, 4, "e3", 0, [["m2", 5, 6, 7, 8, 2]]);
  const implementar = daEtapa(calcularUso(b, { demandaId: "I-1" }), "implementar");
  assert.deepEqual(implementar.modelos, [
    {
      modelo: "anthropic/m1",
      tokens_entrada: 11,
      tokens_saida: 22,
      tokens_cache_leitura: 33,
      tokens_cache_escrita: 44,
      custo: 1.5,
      chamadas: 0,
    },
    {
      modelo: "anthropic/m2",
      tokens_entrada: 5,
      tokens_saida: 6,
      tokens_cache_leitura: 7,
      tokens_cache_escrita: 8,
      custo: 2,
      chamadas: 0,
    },
  ]);
  assert.deepEqual(implementar.tokens, { entrada: 16, saida: 28, cacheLeitura: 40, cacheEscrita: 52, total: 136 });
  assert.deepEqual(implementar.custo, { conhecido: 3.5, trabalhosSemCusto: 0 });
  assert.deepEqual(
    implementar.modelos.map((x) => [x.modelo, x.tokens_entrada]),
    [
      ["anthropic/m1", 11],
      ["anthropic/m2", 5],
    ],
  );
});

test("CA-3: rodadas mais o ticket sem rodada somam o total", () => {
  const b = bancoDaDemanda();
  gravarExecucao(b, 1, "e0", 0, [["m1", 1, 1, 1, 1, 1]]);
  gravarExecucao(b, 2, "e1", 1, [["m1", 2, 2, 2, 2, 2]]);
  gravarExecucao(b, 4, "e2", 0, [["m1", 4, 4, 4, 4, 4]]);
  const porEtapa = calcularUso(b, { demandaId: "I-1" });
  assert.equal(daEtapa(porEtapa, "planejar").modelos[0]?.tokens_entrada, 1);
  assert.equal(daEtapa(porEtapa, "implementar").modelos[0]?.tokens_entrada, 6);
  assert.deepEqual(totalDasEtapas(porEtapa), [3, 1, 3 * 60_000, 28, 7, 0]);
});

test("CA-4: execução de sessão retomada aparece uma vez", () => {
  const b = bancoDaDemanda();
  gravarExecucao(b, 2, "e1", 1, [["m1", 1, 1, 1, 1, 1]]);
  gravarExecucao(b, 2, "e2", 0, [["m1", 1, 1, 1, 1, 1]]); // mesma sessão s2, retomada
  const implementar = daEtapa(calcularUso(b, { demandaId: "I-1" }), "implementar");
  assert.equal(implementar.execucoes, 2);
  assert.equal(implementar.modelos[0]?.tokens_entrada, 2);
});

test("CA-5 e CA-6: custo incompleto com modelo desconhecido; completo soma os informados", () => {
  const b = bancoDaDemanda();
  gravarExecucao(b, 2, "e1", 0, [["m1", 1, 1, 1, 1, null]]);
  gravarExecucao(b, 2, "e2", 0, [["m2", 1, 1, 1, 1, 2.5]]);
  const recorte = { demandaId: "I-1" };
  const incompleto = daEtapa(calcularUso(b, recorte), "implementar");
  assert.deepEqual(incompleto.custo, { conhecido: 2.5, trabalhosSemCusto: 1 });
  assert.deepEqual(
    incompleto.modelos.map((x) => x.custo),
    [null, 2.5],
  );
  gravarExecucao(b, 4, "e3", 0, [["m1", 1, 1, 1, 1, 1]]);
  b.exec("UPDATE uso_modelo_execucao SET custo = 1.5 WHERE custo IS NULL");
  assert.deepEqual(daEtapa(calcularUso(b, recorte), "implementar").custo, { conhecido: 5, trabalhosSemCusto: 0 });
  b.exec("UPDATE uso_modelo_execucao SET custo = NULL WHERE execucao_id = 'e3'");
  // O custo desconhecido some diante do conhecido: o modelo vira piso e o Trabalho sem custo é avisado.
  const parcial = daEtapa(calcularUso(b, recorte), "implementar");
  assert.equal(parcial.modelos[0]?.custo, 1.5);
  assert.deepEqual(parcial.custo, { conhecido: 4, trabalhosSemCusto: 1 });
});

test("CA-7: custo externo em campo próprio, só de sessão cuja dona é a demanda", () => {
  const b = bancoDaDemanda();
  b.exec(
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-2', 'p', 't', 'problema', 'd', 'em_execucao', '2026-01-01T00:00:00.000Z', 'f', 's', 1, 'b')`,
  );
  gravarExecucao(b, 2, "e1", 0, [["m1", 1, 1, 1, 1, 1]]);
  gravarUsoDeclarado(b, "a", "I-1", [linhaDeUsoDeclarado(3), linhaDeUsoDeclarado(null)]);
  gravarUsoDeclarado(b, "de-outra", "I-2", [linhaDeUsoDeclarado(100)]);
  const porEtapa = calcularUso(b, { demandaId: "I-1" });
  const desenho = daEtapa(porEtapa, "entender_e_desenhar");
  assert.deepEqual(desenho.custoExterno, { conhecido: 3, trabalhosSemCusto: 1, sessoes: 1 });
  assert.deepEqual(desenho.custo, { conhecido: 3, trabalhosSemCusto: 1 });
  assert.deepEqual(daEtapa(porEtapa, "implementar").custo, { conhecido: 1, trabalhosSemCusto: 0 });
  assert.deepEqual(totalDasEtapas(porEtapa).slice(4), [4, 1]);
});

test("CA-SDLC-24: custo externo soma no total externo, fora do custo interno e das rodadas", () => {
  const b = bancoDaDemanda();
  gravarUsoDeclarado(b, "a", "I-1", [linhaDeUsoDeclarado(2)]);
  gravarUsoDeclarado(b, "b", "I-1", [linhaDeUsoDeclarado(7)]);
  const porEtapa = calcularUso(b, { demandaId: "I-1" });
  assert.deepEqual(daEtapa(porEtapa, "entender_e_desenhar").custoExterno, {
    conhecido: 9,
    trabalhosSemCusto: 0,
    sessoes: 2,
  });
  for (const [etapa, valor] of porEtapa.entries()) {
    if (etapa === "entender_e_desenhar") continue;
    assert.deepEqual(valor.custoExterno, { conhecido: 0, trabalhosSemCusto: 0, sessoes: 0 }, etapa);
    assert.deepEqual(valor.custo, { conhecido: 0, trabalhosSemCusto: 0 }, etapa);
  }
});

test("o total soma o Uso declarado da demanda, e cada execução sem custo conta uma sessão", () => {
  const b = bancoDaDemanda();
  gravarExecucao(b, 2, "e1", 0, [["m1", 1, 1, 0, 0, 4.2]]);
  gravarExecucao(b, 2, "e2", 0, [
    ["m1", 1, 1, 0, 0, null],
    ["m2", 1, 1, 0, 0, null],
  ]);
  gravarExecucao(b, 2, "e3", 0, [["m1", 1, 1, 0, 0, null]]);
  gravarUsoDeclarado(b, "a", "I-1", [linhaDeUsoDeclarado(3)]);
  const porEtapa = calcularUso(b, { demandaId: "I-1" });
  assert.deepEqual(totalDasEtapas(porEtapa).slice(4), [7.2, 2]);
  assert.deepEqual(daEtapa(porEtapa, "implementar").custo, { conhecido: 4.2, trabalhosSemCusto: 2 });
  assert.equal(daEtapa(porEtapa, "implementar").textoDoCusto, "≥ US$ 4,20 (2 sessões sem custo)");
  assert.equal(daEtapa(porEtapa, "entender_e_desenhar").textoDoCusto, "US$ 3,00");
});

test("CA-7: sessão declarada sem linhas não conta como sessão externa", () => {
  const b = bancoDaDemanda();
  gravarUsoDeclarado(b, "a", "I-1", []);
  assert.deepEqual(daEtapa(calcularUso(b, { demandaId: "I-1" }), "entender_e_desenhar").custoExterno, {
    conhecido: 0,
    trabalhosSemCusto: 0,
    sessoes: 0,
  });
});

test("consumo por mês: cada execução uma vez, retomada somada, custo desconhecido sinalizado", () => {
  const b = bancoDoPeriodo();
  const fev = daEtapa(calcularUso(b, doMes("2026-02")), "implementar");
  assert.equal(fev.execucoes, 2);
  assert.equal(fev.falhas, 1);
  assert.equal(fev.duracaoMs, 3 * 60_000);
  assert.deepEqual(fev.tokens, { entrada: 35, saida: 3, cacheLeitura: 6, cacheEscrita: 9, total: 53 });
  assert.deepEqual(fev.custo, { conhecido: 3, trabalhosSemCusto: 1 });
  assert.deepEqual(
    fev.modelos.map((m) => [m.modelo, m.tokens_entrada, m.custo]),
    [
      ["p/a", 30, 3],
      ["p/b", 5, null],
    ],
  );
  const mar = daEtapa(calcularUso(b, doMes("2026-03")), "implementar");
  assert.equal(mar.execucoes, 2);
  assert.deepEqual(mar.custo, { conhecido: 12, trabalhosSemCusto: 0 });
  assert.equal(mar.duracaoMs, 30_000, "execução em andamento não tem duração");
  const jan = calcularUso(b, doMes("2026-01"));
  assert.equal(daEtapa(jan, "implementar").execucoes, 0);
  assert.deepEqual(daEtapa(jan, "implementar").custo, { conhecido: 0, trabalhosSemCusto: 0 });
});

test("a soma de cada nível, da execução ao projeto, bate com o total", () => {
  const b = bancoDoPeriodo();
  for (const mes of ["2026-01", "2026-02", "2026-03"]) {
    const total = totalDasEtapas(calcularUso(b, doMes(mes)));
    const dosProjetos = ["loja", "site"].map((projeto) => totalDasEtapas(calcularUso(b, { ...doMes(mes), projeto })));
    const dasDemandas = ["I-1", "I-2", "I-3"].map((demandaId) =>
      totalDasEtapas(calcularUso(b, { ...doMes(mes), demandaId })),
    );
    assert.deepEqual(dosProjetos.reduce(somarTotais), total, `${mes} por projeto`);
    assert.deepEqual(dasDemandas.reduce(somarTotais), total, `${mes} por demanda`);
  }
  // Sem período, o recorte do projeto e o da demanda dão o mesmo que a soma dos meses.
  const dosMeses = ["2026-01", "2026-02", "2026-03"].map((mes) => totalDasEtapas(calcularUso(b, doMes(mes))));
  assert.deepEqual(totalDasEtapas(calcularUso(b, {})), dosMeses.reduce(somarTotais));
  assert.deepEqual(totalDasEtapas(calcularUso(b, { projeto: null })), dosMeses.reduce(somarTotais));
});

test("o projeto filtra tudo", () => {
  const b = bancoDoPeriodo();
  const site = calcularUso(b, { ...doMes("2026-03"), projeto: "site" });
  assert.equal(daEtapa(site, "implementar").execucoes, 1);
  assert.equal(daEtapa(site, "implementar").tokens.entrada, 1000);
  const todoOSite = calcularUso(b, { projeto: "site" });
  assert.deepEqual(totalDasEtapas(todoOSite), totalDasEtapas(site));
  assert.equal(daEtapa(calcularUso(b, { projeto: "loja" }), "implementar").execucoes, 3);
});

test("o Uso declarado soma ao medido no mês do registro da demanda, por nível e por demanda, com ≥ quando falta custo", () => {
  const b = bancoDoPeriodo();
  gravarUsoDeclarado(b, "d1", "I-1", [{ ...linhaDeUsoDeclarado(2), tokens_cache_leitura: 3, tokens_cache_escrita: 4 }]);
  gravarUsoDeclarado(b, "d2", "I-1", [
    { ...linhaDeUsoDeclarado(null), tokens_cache_leitura: 3, tokens_cache_escrita: 4 },
  ]);
  gravarUsoDeclarado(b, "d3", "I-3", [linhaDeUsoDeclarado(1)]);
  const jan = calcularUso(b, doMes("2026-01"));
  assert.deepEqual(daEtapa(jan, "entender_e_desenhar").tokens, {
    entrada: 2,
    saida: 2,
    cacheLeitura: 6,
    cacheEscrita: 8,
    total: 18,
  });
  assert.equal(daEtapa(jan, "entender_e_desenhar").textoDoCusto, "≥ US$ 2,00 (1 sessão sem custo)");
  const fev = calcularUso(b, doMes("2026-02"));
  assert.equal(
    daEtapa(fev, "implementar").textoDoCusto,
    "≥ US$ 3,00 (1 sessão sem custo)",
    "fevereiro segue só o medido",
  );
  assert.equal(daEtapa(fev, "entender_e_desenhar").textoDoCusto, "US$ 0,00");
  const mar = calcularUso(b, doMes("2026-03"));
  assert.equal(daEtapa(mar, "entender_e_desenhar").textoDoCusto, "US$ 1,00");
  assert.equal(daEtapa(mar, "implementar").textoDoCusto, "US$ 12,00");
  const daDemanda = calcularUso(b, {
    inicio: intervalo("2026-01").inicio,
    fim: intervalo("2026-03").fim,
    demandaId: "I-1",
  });
  assert.equal(daEtapa(daDemanda, "entender_e_desenhar").textoDoCusto, "≥ US$ 2,00 (1 sessão sem custo)");
  assert.equal(daEtapa(daDemanda, "implementar").textoDoCusto, "≥ US$ 7,00 (1 sessão sem custo)");
  assert.deepEqual(totalDasEtapas(daDemanda).slice(4), [9, 2]);
});

test("por demanda: a demanda só com Uso declarado no período é linha com 0 execuções, e a soma das linhas é o rodapé", () => {
  const b = bancoDoPeriodo();
  gravarUsoDeclarado(b, "d", "I-2", [linhaDeUsoDeclarado(3)]);
  const declarada = calcularUso(b, { ...doMes("2026-03"), demandaId: "I-2" });
  assert.equal(totalDasEtapas(declarada)[0], 0);
  assert.equal(daEtapa(declarada, "entender_e_desenhar").textoDoCusto, "US$ 3,00");
  const dasDemandas = ["I-1", "I-2", "I-3"].map((demandaId) =>
    totalDasEtapas(calcularUso(b, { ...doMes("2026-03"), demandaId })),
  );
  assert.deepEqual(dasDemandas.reduce(somarTotais), totalDasEtapas(calcularUso(b, doMes("2026-03"))));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bancoDoPeriodo,
  em,
  gravarDecisaoEm,
  gravarTicket,
  gravarUsoDeclarado,
  linhaDeUsoDeclarado,
} from "../../../../apoio-testes/banco_de_metricas.ts";
import type { TipoMetrica } from "../../../etapas/definicao/tipos_declaraveis.ts";
import { type MetricasDaEtapa, metricasDasDemandasDoPeriodo, metricasDosMeses, NIVEIS } from "./metricas_do_periodo.ts";

const [FEV, MAR] = [1, 2];
const ver = <T>(x: T | undefined): T => {
  assert.ok(x);
  return x;
};

/** O valor da Métrica de `tipo` na Etapa. */
const valorDe = (etapas: MetricasDaEtapa[], etapa: string, tipo: TipoMetrica): unknown =>
  etapas.find((e) => e.etapa === etapa)?.metricas.find((m) => m.definicao.tipo === tipo)?.valor;

test("o total do mês soma o Uso de todas as Etapas: cada execução uma vez, retomada somada, custo desconhecido sinalizado", () => {
  const meses = metricasDosMeses(bancoDoPeriodo(), { de: "2026-01", ate: "2026-03" });
  assert.deepEqual(
    meses.map((m) => m.mes),
    ["2026-01", "2026-02", "2026-03"],
  );
  const { total: fev } = ver(meses[FEV]);
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
  const { total: mar } = ver(meses[MAR]);
  assert.equal(mar.execucoes, 2);
  assert.deepEqual(mar.custo, { conhecido: 12, trabalhosSemCusto: 0 });
  assert.equal(mar.duracaoMs, 30_000, "execução em andamento não tem duração");
  assert.equal(ver(meses[0]).total.execucoes, 0);
  assert.deepEqual(ver(meses[0]).total.custo, { conhecido: 0, trabalhosSemCusto: 0 });
});

test("a soma de cada nível, da execução ao projeto, bate com o total", () => {
  const b = bancoDoPeriodo();
  for (const m of metricasDosMeses(b, { de: "2026-01", ate: "2026-03" })) {
    assert.deepEqual(
      m.niveis.map((n) => n.nivel),
      [...NIVEIS],
    );
    const { modelos: _, ...total } = m.total;
    for (const n of m.niveis) assert.deepEqual(n.total, total, `${m.mes} ${n.nivel}`);
  }
  const mar = ver(metricasDosMeses(b, { de: "2026-03", ate: "2026-03" })[0]);
  assert.deepEqual(
    mar.niveis.map((n) => n.grupos),
    [2, 2, 2, 2, 2, 2], // x3 e x4, cada uma na sua sessão, ticket, rodada (a 2 de I-1 e a sem rodada de I-3), demanda e projeto
  );
  const fev = ver(metricasDosMeses(b, { de: "2026-02", ate: "2026-02" })[0]);
  assert.deepEqual(
    fev.niveis.map((n) => n.grupos),
    [2, 1, 1, 1, 1, 1], // a retomada: duas execuções na mesma sessão, ticket, rodada e demanda
  );
});

test("fatos do mês: demandas, tickets e PRs; e as Métricas de cada uma das nove Etapas", () => {
  const meses = metricasDosMeses(bancoDoPeriodo(), { de: "2026-01", ate: "2026-03" });
  const [jan, fev, mar] = [ver(meses[0]), ver(meses[1]), ver(meses[2])];
  assert.deepEqual(jan.demandas, { registradas: 1, concluidas: 0 }); // I-1, pela primeira evidência
  assert.deepEqual(mar.demandas, { registradas: 2, concluidas: 1 });
  assert.deepEqual(fev.tickets, { criados: 2, concluidos: 2 });
  assert.deepEqual(mar.tickets, { criados: 2, concluidos: 1 });
  assert.deepEqual(fev.prs, { abertos: 1, mergeados: 1 });
  assert.equal(fev.etapas.length, 9);
  assert.deepEqual(
    fev.etapas.map((e) => e.metricas.map((m) => m.definicao.tipo).join()).filter((tipos) => tipos.includes("nota")),
    ["uso,nota_humana"],
  );
  assert.deepEqual(valorDe(fev.etapas, "encerrar_rodada", "nota_humana"), { soma: 9, quantidade: 2, media: 4.5 });
  assert.deepEqual(valorDe(jan.etapas, "encerrar_rodada", "nota_humana"), { soma: 0, quantidade: 0, media: null });
  assert.deepEqual(valorDe(fev.etapas, "implementar", "alteracoes_posteriores"), {
    adicionadas: 30,
    alteradasPorHumanos: 5,
  });
  assert.deepEqual(valorDe(mar.etapas, "implementar", "alteracoes_posteriores"), {
    adicionadas: 0,
    alteradasPorHumanos: 0,
  });
});

test("PRs por coorte do mês de abertura: o pr_aberto da rodada migrada conta, e mergeado nunca passa de aberto", () => {
  const b = bancoDoPeriodo();
  for (const r of [3, 4, 5])
    b.exec(
      `INSERT INTO rodada VALUES ('I-1', ${String(r)}, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'b${String(r)}')`,
    );
  b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
    VALUES ('I-1', 4, 'encerrar_rodada', 'concluido', '${em("2026-03")}', 3)`);
  // aprovado em março, PR aberto em fevereiro na própria rodada (backfill): entra na coorte de fevereiro
  gravarDecisaoEm(b, ["I-1", 4, 1], ["gate_pr", "aprovado", null], em("2026-03"));
  for (const r of [3, 4])
    b.prepare(
      "INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, tipo, dados, em) VALUES (?, 'I-1', ?, 'pr_aberto', '{}', ?)",
    ).run(`ep${String(r)}`, r, em("2026-02"));
  const meses = metricasDosMeses(b, { de: "2026-02", ate: "2026-03" });
  assert.deepEqual(ver(meses[0]).prs, { abertos: 3, mergeados: 2 }); // rodadas 1 (ticket), 3 e 4; a 5 não tem PR
  assert.deepEqual(ver(meses[1]).prs, { abertos: 0, mergeados: 0 });
});

test("o projeto filtra tudo", () => {
  const mar = ver(metricasDosMeses(bancoDoPeriodo(), { projeto: "site", de: "2026-03", ate: "2026-03" })[0]);
  assert.equal(mar.projeto, "site");
  assert.equal(mar.total.execucoes, 1);
  assert.deepEqual(mar.demandas, { registradas: 1, concluidas: 0 });
  assert.equal(mar.etapas.length, 9);
});

test("por demanda: só quem teve execução no período, com o estado atual, as Reprovações, a conformidade e a nota do período", () => {
  const b = bancoDoPeriodo();
  // Uma revisão da rodada que exigiu alteração, e o plano da rodada 1 com um arquivo de dois: o commit do ticket 1 tem só um.
  gravarTicket(b, "I-1", 4, "revisar_rodada", 1);
  gravarDecisaoEm(b, ["I-1", 4, 1], ["gate_revisao_rodada", "reprovado", null], em("2026-02"));
  b.exec(`INSERT INTO versao_plano (demanda_id, numero, origem, autor_tipo, criada_em, dados) VALUES ('I-1', 1,
    'aprovacao_do_planejamento', 'fabriquinha', '${em("2026-01")}', '${JSON.stringify({
      demanda_id: "I-1",
      criterios: [],
      arquivos_previstos: ["a.ts", "b.ts"],
      rodadas: [{ demanda_id: "I-1", rodada_id: 1, titulo: "r", e2e: false, arquivos_previstos: ["a.ts", "b.ts"] }],
      tickets: [
        {
          demanda_id: "I-1",
          ticket_id: 1,
          rodada_id: 1,
          titulo: "t",
          descricao: "d",
          arquivos_previstos: ["a.ts", "b.ts"],
        },
      ],
    })}')`);
  const { demandas: todas, total } = metricasDasDemandasDoPeriodo(b, { de: "2026-01", ate: "2026-03" });
  assert.deepEqual(
    todas.map((d) => [d.demanda, d.projeto, d.titulo, d.estado, d.execucoes, d.reprovacoes, d.conformidade, d.nota]),
    [
      ["I-1", "loja", "Título I-1", "em_execucao", 3, 1, 50, 4.5],
      ["I-3", "site", "Título I-3", "em_execucao", 1, 0, null, null],
    ],
  );
  assert.deepEqual(ver(todas[0]).custo, { conhecido: 7, trabalhosSemCusto: 1 });
  assert.equal(total.execucoes, 4);
  assert.equal(total.textoDoCusto, "≥ US$ 15,00 (1 sessão sem custo)");
  assert.deepEqual([total.conformidade, total.nota], [50, 4.5]);
  assert.deepEqual(
    metricasDasDemandasDoPeriodo(b, { projeto: "site", de: "2026-03", ate: "2026-03" }).demandas.map((d) => d.demanda),
    ["I-3"],
  );
  assert.deepEqual(metricasDasDemandasDoPeriodo(b, { de: "2026-01", ate: "2026-01" }).demandas, []);
});

test("execução sem uso registrado soma zero sem custo incompleto, e PR aprovado sem nota conta sem entrar na média", () => {
  const b = bancoDoPeriodo();
  b.prepare(
    "INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('x9', 's3', ?, NULL, 0)",
  ).run(em("2026-04"));
  gravarDecisaoEm(b, ["I-1", 2, 3], ["gate_pr", "aprovado", null], em("2026-04"));
  const abr = ver(metricasDosMeses(b, { de: "2026-04", ate: "2026-04" })[0]);
  assert.equal(abr.total.execucoes, 1);
  assert.deepEqual(abr.total.custo, { conhecido: 0, trabalhosSemCusto: 0 });
  assert.deepEqual(abr.prs, { abertos: 0, mergeados: 0 }); // o PR é da coorte de fevereiro
  assert.deepEqual(valorDe(abr.etapas, "encerrar_rodada", "nota_humana"), { soma: 0, quantidade: 0, media: null });
});

test("o Uso declarado soma ao medido no mês do registro da demanda, por nível e por demanda, com ≥ quando falta custo", () => {
  const b = bancoDoPeriodo();
  const declarada = (custo: number | null) => ({
    ...linhaDeUsoDeclarado(custo),
    tokens_saida: 2,
    tokens_cache_leitura: 3,
    tokens_cache_escrita: 4,
  });
  gravarUsoDeclarado(b, "d1", "I-1", [declarada(2)]);
  gravarUsoDeclarado(b, "d2", "I-1", [declarada(null)]);
  gravarUsoDeclarado(b, "d3", "I-3", [declarada(1)]);
  const [jan, fev, mar] = metricasDosMeses(b, { de: "2026-01", ate: "2026-03" }).map(ver);
  assert.deepEqual(ver(jan).total.tokens, { entrada: 2, saida: 4, cacheLeitura: 6, cacheEscrita: 8, total: 20 });
  assert.equal(ver(jan).total.textoDoCusto, "≥ US$ 2,00 (1 sessão sem custo)");
  assert.equal(ver(fev).total.textoDoCusto, "≥ US$ 3,00 (1 sessão sem custo)", "fevereiro segue só o medido");
  assert.equal(ver(mar).total.textoDoCusto, "US$ 13,00");
  for (const m of [ver(jan), ver(mar)])
    for (const n of m.niveis) assert.equal(n.total.textoDoCusto, m.total.textoDoCusto, `${m.mes} ${n.nivel}`);
  const { demandas, total } = metricasDasDemandasDoPeriodo(b, { de: "2026-01", ate: "2026-03" });
  assert.equal(ver(demandas[0]).textoDoCusto, "≥ US$ 9,00 (2 sessões sem custo)");
  assert.equal(total.textoDoCusto, "≥ US$ 18,00 (2 sessões sem custo)");
});

test("por demanda: a demanda só com Uso declarado no período é linha com 0 execuções, e a soma das linhas é o rodapé", () => {
  const b = bancoDoPeriodo();
  gravarUsoDeclarado(b, "d", "I-2", [{ ...linhaDeUsoDeclarado(3), tokens_saida: 2 }]);
  const { demandas, total } = metricasDasDemandasDoPeriodo(b, { de: "2026-03", ate: "2026-03" });
  const declarada = demandas.find((d) => d.demanda === "I-2");
  assert.deepEqual(
    [declarada?.projeto, declarada?.titulo, declarada?.estado, declarada?.execucoes, declarada?.textoDoCusto],
    ["loja", "Título I-2", "concluida", 0, "US$ 3,00"],
  );
  assert.equal(
    demandas.reduce((s, d) => s + d.custo.conhecido, 0),
    total.custo.conhecido,
  );
  assert.equal(
    demandas.reduce((s, d) => s + d.tokens.total, 0),
    total.tokens.total,
  );
});

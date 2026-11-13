import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import { carregarDemanda } from "../../src/modulos/ciclo_de_vida/processo/armazenamento/agregado_da_demanda.ts";
import { carregarTrabalhosDaDemanda } from "../../src/modulos/trabalho_agentico/armazenamento/trabalho_agentico.ts";
import { semearVolume, VOLUMES_SINTETICOS } from "./semeadura_dos_volumes.ts";

const AGORA = new Date("2026-11-12T12:00:00.000Z");

test("os três volumes crescem em demandas e em meses de histórico", () => {
  assert.deepEqual(
    VOLUMES_SINTETICOS.map((v) => v.nome),
    ["pequeno", "médio", "grande"],
  );
  for (const [menor, maior] of [
    [VOLUMES_SINTETICOS[0], VOLUMES_SINTETICOS[1]],
    [VOLUMES_SINTETICOS[1], VOLUMES_SINTETICOS[2]],
  ]) {
    assert.ok(menor && maior && menor.demandas < maior.demandas && menor.meses < maior.meses);
  }
});

test("semeia demandas com tickets, tentativas, sessões e uso, espalhadas pelos meses do volume, pelo esquema real", () => {
  const { raiz, banco, fechar } = abrirBancoTemporario();
  try {
    const alvos = semearVolume(banco, { nome: "teste", demandas: 20, meses: 3 }, AGORA);
    const contar = (sql: string) => (banco.prepare(sql).get() as { n: number }).n;
    const porEstado = Object.fromEntries(
      banco
        .prepare("SELECT estado, count(*) AS n FROM processo_demanda GROUP BY estado")
        .all()
        .map((linha) => [String(linha.estado), Number(linha.n)]),
    );

    assert.deepEqual(porEstado, {
      concluida: 15,
      cancelada: 1,
      gate_demanda: 1,
      gate_planejamento: 1,
      em_execucao: 1,
      revisar_demanda: 1,
    });
    assert.equal(contar("SELECT count(*) AS n FROM projeto"), 3);
    assert.equal(contar("SELECT count(DISTINCT projeto) AS n FROM demanda"), 3);
    assert.equal(contar("SELECT count(*) AS n FROM ticket_demanda"), 120);
    assert.equal(contar("SELECT count(*) AS n FROM tentativa"), 136);
    assert.equal(contar("SELECT count(*) AS n FROM trabalho_agentico"), 120);
    assert.equal(contar("SELECT count(*) AS n FROM processo_do_trabalho"), 136);
    assert.equal(contar("SELECT count(*) AS n FROM uso_modelo_execucao"), 136);
    assert.equal(contar("SELECT count(*) AS n FROM decisao_ticket"), 84);
    assert.equal(contar("SELECT count(*) AS n FROM pull_request"), 31);
    assert.equal(contar("SELECT count(*) AS n FROM processo_do_trabalho WHERE fim IS NULL"), 2);

    const periodo = banco
      .prepare(
        "SELECT min(inicio) AS primeiro, max(coalesce(fim, inicio)) AS ultimo, count(DISTINCT substr(inicio, 1, 7)) AS meses FROM processo_do_trabalho",
      )
      .get() as { primeiro: string; ultimo: string; meses: number };
    const tresMesesAntes = new Date(AGORA.getTime() - (3 * 30 + 1) * 86_400_000).toISOString();
    assert.ok(periodo.primeiro >= tresMesesAntes, periodo.primeiro);
    assert.ok(periodo.ultimo < AGORA.toISOString(), periodo.ultimo);
    assert.ok(periodo.meses >= 3);

    assert.equal(alvos.projeto, "loja");
    assert.equal(carregarDemanda(banco, alvos.demandaEmExecucao).demanda.estado, "em_execucao");
    const sessaoTerminada = carregarTrabalhosDaDemanda(banco, alvos.demandaEmExecucao).execucoes.find(
      (execucao) => execucao.trabalho_id === alvos.sessaoTerminada,
    );
    assert.ok(sessaoTerminada?.fim);
    assert.deepEqual(readdirSync(join(raiz, "sessoes", alvos.sessaoTerminada)), [
      `2026-01-01T00-00-00-000Z_${alvos.sessaoTerminada}.jsonl`,
    ]);
  } finally {
    fechar();
  }
});

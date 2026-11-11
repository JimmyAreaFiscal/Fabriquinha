import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco_temporario.ts";
import {
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  montarAgregadoDemanda,
} from "../../../../apoio-testes/cenarios_de_demanda.ts";
import { relogioFixo } from "../../../compartilhado/nucleo/relogio.ts";
import { BoardDeDemandas, PaginaDaDemanda } from "../../../entrega/contrato/demanda.ts";
import { consultarBoardDeDemandas, consultarDemanda } from "./demanda.ts";

const relogio = relogioFixo("2026-01-01T00:00:00.000Z");
const semSessaoViva = () => undefined;

/** A demanda `id` com `quantas` dependentes ainda em andamento, que o cancelamento levaria junto. */
function demandaComDependentes(banco: DatabaseSync, id: number, quantas: number): string {
  const predecessora = `I-${String(id)}`;
  gravarAgregadoPronto(banco, montarAgregadoDemanda(predecessora, "em_execucao"));
  for (let i = 1; i <= quantas; i++) {
    const dependente = `I-${String(id + i)}`;
    gravarAgregadoPronto(banco, montarAgregadoDemanda(dependente, "entender_e_desenhar"));
    banco
      .prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)")
      .run(dependente, predecessora);
  }
  return predecessora;
}

/** Quantas vezes `consulta` pede ao banco para preparar um SQL. */
function contarPrepare(banco: DatabaseSync, consulta: () => unknown): number {
  const original = banco.prepare.bind(banco);
  let chamadas = 0;
  banco.prepare = (sql) => {
    chamadas++;
    return original(sql);
  };
  try {
    consulta();
  } finally {
    // @ts-expect-error devolve a função do protótipo, apagando a que o teste pôs na instância
    delete banco.prepare;
  }
  return chamadas;
}

test("CA-5: consultarDemanda prepara o mesmo número de SQL com 1 e com 20 dependentes", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  const comUm = demandaComDependentes(banco, 1, 1);
  const comVinte = demandaComDependentes(banco, 10, 20);
  consultarDemanda(banco, comUm, relogio, semSessaoViva); // a 1ª consulta do processo prepara a mais o que as seguintes reaproveitam
  const preparosComUm = contarPrepare(banco, () => consultarDemanda(banco, comUm, relogio, semSessaoViva));
  const preparosComVinte = contarPrepare(banco, () => consultarDemanda(banco, comVinte, relogio, semSessaoViva));
  assert.equal(preparosComVinte, preparosComUm);
  assert.equal(consultarDemanda(banco, comVinte, relogio, semSessaoViva).dependentes.length, 20);
});

test("a página traz os dependentes não terminados com título e estado, e cumpre o contrato", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  const id = demandaComDependentes(banco, 1, 2);
  const pagina = consultarDemanda(banco, id, relogio, semSessaoViva);
  assert.deepEqual(pagina.dependentes, [
    { demanda_id: "I-2", titulo: "demanda I-2", estado: "entender_e_desenhar" },
    { demanda_id: "I-3", titulo: "demanda I-3", estado: "entender_e_desenhar" },
  ]);
  assert.deepEqual(PaginaDaDemanda.parse(pagina), pagina);
  assert.equal(banco.isTransaction, false);
});

test("o board bloqueia a demanda só pelas predecessoras que não satisfazem a Dependência", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-1", "concluida"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-2", "em_execucao"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-3", "entender_e_desenhar"));
  const dependeDe = banco.prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-3', ?)");
  dependeDe.run("I-1");
  dependeDe.run("I-2");
  const board = consultarBoardDeDemandas(banco, relogio, semSessaoViva);
  assert.deepEqual(
    board.demandas.map((d) => [d.id, d.bloqueios]),
    [
      ["I-1", []],
      ["I-2", []],
      ["I-3", [{ demanda_id: "I-2", estado: "em_execucao" }]],
    ],
  );
  assert.deepEqual(BoardDeDemandas.parse(board), board);
});

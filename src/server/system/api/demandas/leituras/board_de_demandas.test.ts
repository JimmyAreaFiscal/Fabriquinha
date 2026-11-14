import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  montarAgregadoDemanda,
} from "../../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { relogioFixo } from "../../../../../shared/nucleo/relogio.ts";
import { BoardDeDemandas } from "../../contrato/demanda.ts";
import { consultarBoardDeDemandas } from "./board_de_demandas.ts";
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../../banco_da_fabriquinha.ts";

const relogio = relogioFixo("2026-01-01T00:00:00.000Z");
const semSessaoViva = () => undefined;

test("o board bloqueia a demanda só pelas predecessoras que não satisfazem a Dependência", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-1", "concluida"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-2", "em_execucao"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-3", "entender_e_desenhar"));
  const dependeDe = banco.prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES ('I-3', ?)");
  dependeDe.run("I-1");
  dependeDe.run("I-2");
  const board = consultarBoardDeDemandas(
    banco,
    montarCicloDeVidaDoBanco(banco),
    montarDemandasDoBanco(banco),
    relogio,
    semSessaoViva,
  );
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

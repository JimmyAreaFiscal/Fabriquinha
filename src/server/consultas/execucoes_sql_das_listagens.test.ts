// As listagens de demandas (o Início, o contador de pendências do menu, o board e a página do projeto) leem em lote e
// resumido: o número de execuções SQL de cada uma não cresce com a quantidade de demandas. A prova roda em dois bancos
// semeados pequenos, de tamanhos diferentes, com mais demandas em andamento e mais demandas no projeto no maior.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { abrirBancoTemporario } from "../../../apoio-testes/banco/banco_temporario.ts";
import { relogioFixo } from "../../shared/nucleo/relogio.ts";
import { consultarInicio } from "./inicio/inicio.ts";
import { consultarQuantidadeDePendencias } from "./inicio/quantidade_de_pendencias.ts";
import { consultarBoardDeDemandas } from "./demandas/board_de_demandas.ts";
import { consultarProjeto } from "./projeto/projeto.ts";
import { contarExecucoesSql } from "../../../estresse/referencia/contador_de_execucoes_sql.ts";
import { semearVolume } from "../../../estresse/referencia/semeadura_dos_volumes.ts";
import { montarDemandasDoBanco } from "../composicao/banco_da_fabriquinha.ts";

const AGORA = "2026-11-12T12:00:00.000Z";
const relogio = relogioFixo(AGORA);
const semSessaoViva = () => undefined;

const LISTAGENS: Record<string, (banco: DatabaseSync) => unknown> = {
  inicio: (banco) => consultarInicio(banco, montarDemandasDoBanco(banco), relogio, semSessaoViva),
  contadorDePendencias: (banco) =>
    consultarQuantidadeDePendencias(banco, montarDemandasDoBanco(banco), relogio, semSessaoViva),
  board: (banco) => consultarBoardDeDemandas(banco, montarDemandasDoBanco(banco), relogio, semSessaoViva),
  projetoEmAndamento: (banco) =>
    consultarProjeto(
      banco,
      montarDemandasDoBanco(banco),
      "loja",
      { concluidas: false, arquivadas: false, canceladas: false },
      relogio,
      semSessaoViva,
    ),
  projetoComTodas: (banco) =>
    consultarProjeto(
      banco,
      montarDemandasDoBanco(banco),
      "loja",
      { concluidas: true, arquivadas: true, canceladas: true },
      relogio,
      semSessaoViva,
    ),
};

/** As execuções SQL de cada listagem num banco semeado com `demandas` demandas. */
async function execucoesSqlDasListagens(demandas: number): Promise<Record<string, number>> {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    semearVolume(banco, { nome: `${String(demandas)} demandas`, demandas, meses: 3 }, new Date(AGORA));
    const execucoesPorListagem: Record<string, number> = {};
    for (const [nome, listar] of Object.entries(LISTAGENS)) {
      execucoesPorListagem[nome] = await contarExecucoesSql(() => Promise.resolve(listar(banco)));
    }
    return execucoesPorListagem;
  } finally {
    fechar();
  }
}

test("o Início, o contador de pendências, o board e a página do projeto fazem as mesmas execuções SQL com 30 e com 60 demandas", async () => {
  const comTrinta = await execucoesSqlDasListagens(30);
  const comSessenta = await execucoesSqlDasListagens(60);
  assert.deepEqual(comSessenta, comTrinta);
});

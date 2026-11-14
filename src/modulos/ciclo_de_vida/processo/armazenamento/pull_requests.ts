// Os PRs de cada Espaço de Trabalho (MELHORIAS §10): o único SQL de `pull_request`. O agregado da demanda guarda o PR de
// cada rodada e o final, com a situação observada na hospedagem, e os lê e grava por aqui, na unidade de trabalho dele; o
// Repositório publica e lê o PR na hospedagem, e as decisões sobre o PR são do Ciclo de Vida (§10, regra 6).
import type { DatabaseSync } from "node:sqlite";
import type { LinhasDoAgregado } from "../../../../shared/armazenamento/linhas_do_agregado.ts";
import {
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  type LinhaDaTabela,
  semNulos,
  type TabelaDoAgregado,
} from "../../../../shared/armazenamento/diferenca_do_agregado.ts";

/** Os PRs de uma demanda, como o Ciclo de Vida os guarda: o de cada rodada e o final, sem `rodada_id`. */
interface PullRequestsDaDemanda {
  readonly demanda_id: string;
  readonly pull_requests: readonly (LinhaDaTabela & { rodada_id?: number })[];
}

const TABELA_DOS_PULL_REQUESTS: TabelaDoAgregado<PullRequestsDaDemanda> = {
  nome: "pull_request",
  chave: ["demanda_id", "rodada_id"],
  linhas: ({ demanda_id, pull_requests }) =>
    pull_requests.map((pr) => ({ ...pr, demanda_id, rodada_id: pr.rodada_id ?? null })),
};

/** Os PRs da demanda, na ordem em que foram gravados, sem as colunas nulas. */
export const lerPullRequestsDaDemanda = (linhasDaDemanda: LinhasDoAgregado): Record<string, unknown>[] =>
  linhasDaDemanda("pull_request").map(semNulos);

/** Apaga os PRs que sumiram entre `antes` e `depois`: vai antes de apagar as rodadas, que são mães deles. */
export const apagarPullRequestsQueSumiram = (
  banco: DatabaseSync,
  antes: PullRequestsDaDemanda | undefined,
  depois: PullRequestsDaDemanda,
): void => {
  apagarLinhasQueSumiram(banco, [TABELA_DOS_PULL_REQUESTS], antes, depois);
};

/** Insere os PRs novos e atualiza os que mudaram: vai depois de gravar as rodadas. */
export const gravarPullRequestsNovosEMudados = (
  banco: DatabaseSync,
  antes: PullRequestsDaDemanda | undefined,
  depois: PullRequestsDaDemanda,
): void => {
  gravarLinhasNovasEMudadas(banco, [TABELA_DOS_PULL_REQUESTS], antes, depois);
};

/** Na remoção do projeto: os PRs das `demandaIds`. */
export const apagarPullRequestsDasDemandas = (banco: DatabaseSync, demandaIds: readonly string[]): void => {
  banco
    .prepare("DELETE FROM pull_request WHERE demanda_id IN (SELECT value FROM json_each(?))")
    .run(JSON.stringify(demandaIds));
};

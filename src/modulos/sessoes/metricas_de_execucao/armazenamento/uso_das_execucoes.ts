// O Uso medido das execuções (tabela `uso_modelo_execucao`), uma linha por execução e modelo. Quem diz quais execuções
// ler é a Execução; aqui só se lê e grava o Uso delas.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { UsoDaExecucao } from "../nucleo/uso_da_execucao.ts";
import { instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";

/**
 * O Uso das execuções `execucoes`, na ordem em que foi gravado; custo NULL é desconhecido e volta sem a chave, nunca zero,
 * e o custo sem referência de preço foi informado pelo harness. O custo vem como foi gravado: nada é recalculado.
 */
export const lerUsoDasExecucoes = (banco: DatabaseSync, execucoes: readonly string[]): UsoDaExecucao[] =>
  z.array(UsoDaExecucao).parse(
    instrucaoPreparada(
      banco,
      "SELECT * FROM uso_modelo_execucao WHERE execucao_id IN (SELECT value FROM json_each(?)) ORDER BY rowid",
    )
      .all(JSON.stringify(execucoes))
      .map(({ custo, preco_id, ...uso }) => ({
        ...uso,
        ...(custo !== null && { custo }),
        ...(preco_id !== null && { preco_id }),
      })),
  );

/** Grava cada Uso pela chave (execução e modelo): a chave que já existe troca tokens, custo e a referência do preço. */
export function gravarUsoDasExecucoes(banco: DatabaseSync, usos: readonly UsoDaExecucao[]): void {
  const gravarUso = banco.prepare(
    `INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida,
       tokens_cache_leitura, tokens_cache_escrita, custo, preco_id)
     VALUES ($execucao_id, $modelo_provedor, $modelo_nome, $tokens_entrada, $tokens_saida, $tokens_cache_leitura,
       $tokens_cache_escrita, $custo, $preco_id)
     ON CONFLICT (execucao_id, modelo_provedor, modelo_nome) DO UPDATE SET tokens_entrada = excluded.tokens_entrada,
       tokens_saida = excluded.tokens_saida, tokens_cache_leitura = excluded.tokens_cache_leitura,
       tokens_cache_escrita = excluded.tokens_cache_escrita, custo = excluded.custo,
       preco_id = excluded.preco_id`,
  );
  for (const uso of usos) gravarUso.run({ ...uso, custo: uso.custo ?? null, preco_id: uso.preco_id ?? null });
}

/** Na remoção do projeto: o Uso medido das `execucoes`, o atual e o histórico. */
export function apagarUsoDasExecucoes(banco: DatabaseSync, execucoes: readonly string[]): void {
  for (const tabela of ["uso_modelo_historico", "uso_modelo_execucao"])
    banco
      .prepare(`DELETE FROM ${tabela} WHERE execucao_id IN (SELECT value FROM json_each(?))`)
      .run(JSON.stringify(execucoes));
}

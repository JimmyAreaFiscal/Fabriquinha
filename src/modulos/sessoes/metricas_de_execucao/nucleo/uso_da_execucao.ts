// O Uso medido de cada execução, por modelo (MELHORIAS §9, Métricas de Execução): tokens e custo pertencem à execução,
// nunca à sessão. Funções puras sobre arrays: quem chama persiste o resultado.
import { z } from "zod";
import { colunasDoModelo, type LinhaDeUso } from "../../harness/publico.ts";

const IdTexto = z.string().trim().min(1);
const Tokens = z.number().int().nonnegative();

/** `custo` ausente é desconhecido, não zero. A chave é a execução com o modelo. */
export const UsoDaExecucao = z.object({
  execucao_id: IdTexto,
  modelo_provedor: IdTexto,
  modelo_nome: IdTexto,
  tokens_entrada: Tokens,
  tokens_saida: Tokens,
  tokens_cache_leitura: Tokens,
  tokens_cache_escrita: Tokens,
  custo: z.number().nonnegative().optional(),
});
export type UsoDaExecucao = z.infer<typeof UsoDaExecucao>;

const mesmaChave = (a: UsoDaExecucao, b: UsoDaExecucao): boolean =>
  a.execucao_id === b.execucao_id && a.modelo_provedor === b.modelo_provedor && a.modelo_nome === b.modelo_nome;

/** Registrar de novo a mesma chave substitui o uso, não soma. */
export const registrarUso = (usos: readonly UsoDaExecucao[], uso: UsoDaExecucao): UsoDaExecucao[] => {
  const novo = UsoDaExecucao.parse(uso);
  return [...usos.filter((u) => !mesmaChave(u, novo)), novo];
};

/**
 * Soma o uso à mesma chave, em vez de substituí-lo: a consulta gasta tokens na execução que a pediu, e a coleta do fim
 * da execução não pode apagar o que a consulta já registrou. A parcela sem custo deixa o total sem custo, como na
 * coleta (parcial fica desconhecido, nunca zero).
 */
export const acumularUso = (usos: readonly UsoDaExecucao[], uso: UsoDaExecucao): UsoDaExecucao[] => {
  const novo = UsoDaExecucao.parse(uso);
  const anterior = usos.find((u) => mesmaChave(u, novo));
  if (!anterior) return [...usos, novo];
  const { custo: custoAnterior, ...tokensAnteriores } = anterior;
  return registrarUso(usos, {
    ...tokensAnteriores,
    tokens_entrada: anterior.tokens_entrada + novo.tokens_entrada,
    tokens_saida: anterior.tokens_saida + novo.tokens_saida,
    tokens_cache_leitura: anterior.tokens_cache_leitura + novo.tokens_cache_leitura,
    tokens_cache_escrita: anterior.tokens_cache_escrita + novo.tokens_cache_escrita,
    ...(custoAnterior !== undefined && novo.custo !== undefined && { custo: custoAnterior + novo.custo }),
  });
};

/** A linha de Uso do harness como a execução a guarda; custo desconhecido fica sem a chave, nunca zero. */
export const usoDaExecucaoDaLinha = (execucao_id: string, linha: LinhaDeUso): UsoDaExecucao => ({
  execucao_id,
  ...colunasDoModelo(linha.modelo),
  tokens_entrada: linha.tokens_entrada,
  tokens_saida: linha.tokens_saida,
  tokens_cache_leitura: linha.tokens_cache_leitura,
  tokens_cache_escrita: linha.tokens_cache_escrita,
  ...(linha.custo !== null && { custo: linha.custo }),
});

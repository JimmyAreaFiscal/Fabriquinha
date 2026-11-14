// O Uso medido de cada execução, por modelo (MELHORIAS §9, Métricas de Execução): tokens e custo pertencem à execução,
// nunca à sessão. O custo é informado pelo harness, estimado pelo catálogo de preços (com a referência do preço usado)
// ou desconhecido. Funções puras sobre arrays: quem chama persiste o resultado.
import { z } from "zod";
import { colunasDoModelo, type LinhaDeUso } from "../../harness/publico.ts";
import { custoPeloPreco, type PrecoDoCatalogo } from "../../modelos/publico.ts";

const IdTexto = z.string().trim().min(1);
const Tokens = z.number().int().nonnegative();

/**
 * `custo` ausente é desconhecido, não zero; com `preco_id`, o custo foi estimado pelo preço do catálogo com esse id, e
 * sem ele foi informado pelo harness. A chave é a execução com o modelo.
 */
export const UsoDaExecucao = z.object({
  execucao_id: IdTexto,
  modelo_provedor: IdTexto,
  modelo_nome: IdTexto,
  tokens_entrada: Tokens,
  tokens_saida: Tokens,
  tokens_cache_leitura: Tokens,
  tokens_cache_escrita: Tokens,
  custo: z.number().nonnegative().optional(),
  preco_id: z.number().int().positive().optional(),
});
export type UsoDaExecucao = z.infer<typeof UsoDaExecucao>;

const mesmaChave = (a: UsoDaExecucao, b: UsoDaExecucao): boolean =>
  a.execucao_id === b.execucao_id && a.modelo_provedor === b.modelo_provedor && a.modelo_nome === b.modelo_nome;

/** Registrar de novo a mesma chave substitui o uso, não soma. @testes os testes montam o Uso gravado com ele */
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
  const { custo: custoAnterior, preco_id: precoAnterior, ...tokensAnteriores } = anterior;
  // A soma com uma parcela estimada é estimada: guarda a referência do preço dela (a mais nova, se as duas forem).
  const precoDaParcelaEstimada = novo.preco_id ?? precoAnterior;
  return registrarUso(usos, {
    ...tokensAnteriores,
    tokens_entrada: anterior.tokens_entrada + novo.tokens_entrada,
    tokens_saida: anterior.tokens_saida + novo.tokens_saida,
    tokens_cache_leitura: anterior.tokens_cache_leitura + novo.tokens_cache_leitura,
    tokens_cache_escrita: anterior.tokens_cache_escrita + novo.tokens_cache_escrita,
    ...(custoAnterior !== undefined &&
      novo.custo !== undefined && {
        custo: custoAnterior + novo.custo,
        ...(precoDaParcelaEstimada !== undefined && { preco_id: precoDaParcelaEstimada }),
      }),
  });
};

/**
 * O Uso sem custo informado recebe o custo pelo `preco` vigente do catálogo, com a referência dele; o custo informado
 * fica como veio, e sem preço o custo segue desconhecido. A estimativa é gravada no fim da execução: a leitura nunca
 * recalcula o custo de uma execução antiga.
 */
export const estimarCustoPeloCatalogo = (uso: UsoDaExecucao, preco: PrecoDoCatalogo | undefined): UsoDaExecucao =>
  uso.custo !== undefined || !preco ? uso : { ...uso, custo: custoPeloPreco(uso, preco), preco_id: preco.id };

/** O Uso de uma execução como linha de Uso, com o custo estimado marcado; o banco não guarda as chamadas do uso medido, por isso 0. */
export const linhaDeUsoDaExecucao = (uso: UsoDaExecucao): LinhaDeUso => ({
  modelo: `${uso.modelo_provedor}/${uso.modelo_nome}`,
  tokens_entrada: uso.tokens_entrada,
  tokens_saida: uso.tokens_saida,
  tokens_cache_leitura: uso.tokens_cache_leitura,
  tokens_cache_escrita: uso.tokens_cache_escrita,
  custo: uso.custo ?? null,
  ...(uso.preco_id !== undefined && { custo_estimado: true }),
  chamadas: 0,
});

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

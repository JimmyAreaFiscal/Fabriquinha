// O preço de cada modelo no catálogo de Sessões (MELHORIAS §9, Modelos; §13, item 2): dólares por milhão de tokens de
// cada tipo, de onde o preço veio e de quando a quando ele vale. É com ele que a Fabriquinha estima o custo que o
// harness não informou.
import { z } from "zod";
import { Modelo } from "./modelo.ts";

const DolaresPorMilhao = z.number().nonnegative();

/** Dólares por milhão de tokens de entrada, de saída e de cache lido e escrito: a unidade em que o pi declara o preço. */
const PrecoPorMilhaoDeTokens = z.object({
  entrada: DolaresPorMilhao,
  saida: DolaresPorMilhao,
  cache_leitura: DolaresPorMilhao,
  cache_escrita: DolaresPorMilhao,
});

/** O preço de um modelo como a fonte o declara; `origem` diz qual fonte (hoje, o catálogo do pi). */
export const PrecoDoModelo = z.object({
  modelo: Modelo,
  usd_por_milhao: PrecoPorMilhaoDeTokens,
  origem: z.string().trim().min(1),
});
export type PrecoDoModelo = z.infer<typeof PrecoDoModelo>;

/** O preço guardado no catálogo: o `id` é a referência que a estimativa grava, e a vigência vai de `vigente_de` a `vigente_ate` (aberta, se ausente). */
export interface PrecoDoCatalogo extends PrecoDoModelo {
  id: number;
  vigente_de: string;
  vigente_ate?: string;
}

/** Os tokens de cada tipo que o preço cobra. */
interface TokensCobrados {
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache_leitura: number;
  tokens_cache_escrita: number;
}

/** O custo em dólares de `tokens` pelo preço `usd_por_milhao`. */
export const custoPeloPreco = (
  tokens: TokensCobrados,
  { usd_por_milhao }: Pick<PrecoDoModelo, "usd_por_milhao">,
): number =>
  (tokens.tokens_entrada * usd_por_milhao.entrada +
    tokens.tokens_saida * usd_por_milhao.saida +
    tokens.tokens_cache_leitura * usd_por_milhao.cache_leitura +
    tokens.tokens_cache_escrita * usd_por_milhao.cache_escrita) /
  1_000_000;

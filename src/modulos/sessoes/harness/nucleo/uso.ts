// O Uso que o harness mede (MELHORIAS §9, regra 5): o formato da Fabriquinha para o consumo de cada modelo, para o qual o
// adapter traduz o que o harness registra.

/**
 * O Uso de um modelo (`provedor/modelo`): tokens, chamadas e o custo, `null` quando desconhecido (D10), nunca 0.
 */
export interface LinhaDeUso {
  modelo: string;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache_leitura: number;
  tokens_cache_escrita: number;
  custo: number | null;
  chamadas: number;
}

/** Desfaz `LinhaDeUso.modelo` nas colunas `modelo_provedor` e `modelo_nome` do banco. */
export function colunasDoModelo(modelo: string): { modelo_provedor: string; modelo_nome: string } {
  const barra = modelo.indexOf("/");
  return { modelo_provedor: modelo.slice(0, barra), modelo_nome: modelo.slice(barra + 1) };
}

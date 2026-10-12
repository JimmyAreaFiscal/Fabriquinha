// Texto curto sobre o que os coletores produziram (F3 §6), comum ao prompt das etapas (F4 §6.3) e ao PR (F3 §4.6).

/** Resultado de um comando de coletor, em palavras. */
export function resultado(r: { codigoSaida: number | null; estourou: boolean }): string {
  if (r.estourou) return "estourou o tempo";
  return r.codigoSaida === 0 ? "passou" : `reprovou (código ${String(r.codigoSaida)})`;
}

/** As linhas de um arquivo no diff: `+3 −1`, ou `binário`. */
export const linhas = (a: { adicionadas: number | null; removidas: number | null }): string =>
  a.adicionadas === null ? "binário" : `+${String(a.adicionadas)} −${String(a.removidas)}`;

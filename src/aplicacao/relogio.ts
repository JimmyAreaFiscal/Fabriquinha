// O relógio único da aplicação: o instante atual no formato que os gates e o agregado gravam.

/** O instante atual, em ISO 8601. */
export const instanteAtual = (): { agora: string } => ({ agora: new Date().toISOString() });

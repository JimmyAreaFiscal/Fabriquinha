// A ConfiguracaoAgente nas tabelas que a guardam (ticket, etapa do projeto, execução): as colunas planas
// `modelo_provedor`, `modelo_nome` e `effort` mantêm o nome; o domínio só vê o valor `configuracao_agente`.
import type { ConfiguracaoAgente } from "../nucleo/configuracao_agente.ts";

/** As três colunas de uma linha a gravar; o ausente é NULL. */
export const colunasDaConfiguracaoAgente = (configuracao: ConfiguracaoAgente | undefined) => ({
  modelo_provedor: configuracao?.modelo?.provedor ?? null,
  modelo_nome: configuracao?.modelo?.nome ?? null,
  effort: configuracao?.effort ?? null,
});

/** A linha lida sem as três colunas e com `configuracao_agente`, que só existe se alguma tinha valor. */
export function linhaComConfiguracaoAgente<Linha extends Record<string, unknown>>({
  modelo_provedor: provedor,
  modelo_nome: nome,
  effort,
  ...resto
}: Linha) {
  const configuracao = {
    ...(provedor !== null && { modelo: { provedor, nome } }),
    ...(effort !== null && { effort }),
  };
  return { ...resto, ...(Object.keys(configuracao).length > 0 && { configuracao_agente: configuracao }) };
}

// A definição do `resolver_conflito`: o conflito do PR final, resolvido pelo agente com as verificações do `implementar`.
import {
  type DefinicaoDaEtapa,
  evidenciasDeVerificacao,
  EXTENSOES_DO_AGENTE,
  VERIFICACOES_DE_CODIGO,
} from "../definicao/definicao_da_etapa.ts";

export const DEFINICAO_DO_RESOLVER_CONFLITO: DefinicaoDaEtapa = {
  nome: "resolver_conflito",
  objetivo: "Resolver o conflito de integração da demanda, com as mesmas verificações do Implementar.",
  escopo: "demanda",
  executor: "agente_autonomo",
  evidencias: evidenciasDeVerificacao("resolver_conflito"),
  verificacoes: VERIFICACOES_DE_CODIGO,
  metricas: ["uso"],
  capacidades: { skills: [], extensoes: EXTENSOES_DO_AGENTE },
  instrucao: new URL("resolver_conflito.md", import.meta.url),
  papel: "resolve_o_conflito_da_integracao",
  devolveAoAgente: true,
};

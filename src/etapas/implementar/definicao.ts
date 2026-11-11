// A definição do `implementar`: o agente implementa o ticket, e a Fabriquinha verifica e commita depois dele.
import {
  type DefinicaoDaEtapa,
  evidenciasDeVerificacao,
  EXTENSOES_DO_AGENTE,
  VERIFICACOES_DE_CODIGO,
} from "../definicao/definicao_da_etapa.ts";

export const DEFINICAO_DO_IMPLEMENTAR: DefinicaoDaEtapa = {
  nome: "implementar",
  objetivo: "Implementar o ticket, com testes, até as verificações passarem.",
  escopo: "rodada",
  executor: "agente_autonomo",
  evidencias: evidenciasDeVerificacao("implementar"),
  verificacoes: VERIFICACOES_DE_CODIGO,
  metricas: ["uso", "alteracoes_posteriores"],
  capacidades: { skills: [], extensoes: EXTENSOES_DO_AGENTE },
  instrucao: new URL("implementar.md", import.meta.url),
  devolveAoAgente: true,
};

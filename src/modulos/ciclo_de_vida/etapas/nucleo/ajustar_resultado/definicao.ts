// A definição do `ajustar_resultado`: a sessão do Auditor com o agente depois do PR reprovado.
import { type DefinicaoDaEtapa, EXTENSOES_DO_AGENTE } from "../definicao/definicao_da_etapa.ts";

export const DEFINICAO_DO_AJUSTAR_RESULTADO = {
  nome: "ajustar_resultado",
  objetivo: "Registrar os tickets corretivos do PR reprovado, sem mudar o código.",
  escopo: "rodada",
  executor: "agente_interativo",
  evidencias: [],
  verificacoes: [],
  metricas: ["uso"],
  capacidades: { skills: [], extensoes: EXTENSOES_DO_AGENTE },
  exibicao: {
    rotulo: "Sessão em aberto",
    acao: "Sessão em aberto",
    tituloPadrao: "Sessão de ajustes",
    nasMetricas: { titulo: "Ajustar Resultado", modo: "Gerenciado (interativo)" },
    comoEstado: {
      rotulo: "Sessão de ajustes",
      tom: "aguarda",
      colunaNoInicio: "Ajustes do PR",
      colunaNoProjeto: "Ajustes do PR",
    },
  },
  instrucao: new URL("ajustar_resultado.md", import.meta.url),
  seguePara: "implementar",
  papel: "ajusta_o_pr_reprovado",
} as const satisfies DefinicaoDaEtapa;

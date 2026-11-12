// A definição do `revisar_demanda`: o agente confere a demanda inteira na worktree dela e decide o gate.
import { type DefinicaoDaEtapa, evidenciaExigida, EXTENSOES_DO_AGENTE } from "../definicao/definicao_da_etapa.ts";

export const DEFINICAO_DO_REVISAR_DEMANDA = {
  nome: "revisar_demanda",
  objetivo: "Conferir se a demanda inteira atende os critérios, com estresse e segurança analisados.",
  escopo: "demanda",
  executor: "agente_autonomo",
  evidencias: [
    evidenciaExigida("revisar_demanda", "comprovacao_criterios", "agente", true, "criterios_demanda_atendidos"),
    evidenciaExigida("revisar_demanda", "testes_estresse", "agente"),
    evidenciaExigida("revisar_demanda", "analise_seguranca", "agente"),
  ],
  verificacoes: [],
  metricas: ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"],
  capacidades: {
    skills: ["artefato-comprovacao-criterios", "artefato-testes-estresse", "artefato-analise-seguranca"],
    extensoes: EXTENSOES_DO_AGENTE,
  },
  exibicao: {
    rotulo: "Revisão da demanda",
    acao: "Revisar demanda",
    tituloPadrao: "Revisar a demanda",
    nasMetricas: { titulo: "Revisar demanda", modo: "Gerenciado" },
    comoEstado: {
      rotulo: "Revisão da demanda",
      tom: "rodando",
      colunaNoInicio: "Revisão da demanda",
      colunaNoProjeto: "Revisão da demanda",
    },
  },
  instrucao: new URL("revisar_demanda.md", import.meta.url),
  gate: {
    nome: "gate_revisao_demanda",
    rotulo: "revisão da demanda",
    decisor: "agente",
    esperaEmEstadoProprio: false,
    reprovadoVaiPara: "em_execucao",
  },
} as const satisfies DefinicaoDaEtapa;

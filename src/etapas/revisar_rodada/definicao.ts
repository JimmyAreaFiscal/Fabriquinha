// A definição do `revisar_rodada`: a Fabriquinha roda a fitness antes do agente, que confere a rodada e decide o gate.
import { type DefinicaoDaEtapa, evidenciaExigida, EXTENSOES_DO_AGENTE } from "../definicao/definicao_da_etapa.ts";

export const DEFINICAO_DO_REVISAR_RODADA = {
  nome: "revisar_rodada",
  objetivo: "Conferir se a rodada atende os critérios que cita, sem deixar a fitness quebrada.",
  escopo: "rodada",
  executor: "agente_autonomo",
  evidencias: [
    evidenciaExigida("revisar_rodada", "arquivos_alterados", "fabriquinha"),
    evidenciaExigida("revisar_rodada", "matriz_fitness", "fabriquinha", true, "todas_fitness_passam"),
    evidenciaExigida("revisar_rodada", "explicacao_fitness", "agente"),
    evidenciaExigida("revisar_rodada", "comprovacao_criterios", "agente", true, "criterios_rodada_atendidos"),
  ],
  verificacoes: ["fitness"],
  metricas: ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"],
  capacidades: {
    skills: ["artefato-explicacao-fitness", "artefato-comprovacao-criterios"],
    extensoes: EXTENSOES_DO_AGENTE,
  },
  instrucao: new URL("revisar_rodada.md", import.meta.url),
  gate: {
    nome: "gate_revisao_rodada",
    decisor: "agente",
    esperaEmEstadoProprio: false,
    reprovadoVaiPara: "implementar",
  },
} as const satisfies DefinicaoDaEtapa;

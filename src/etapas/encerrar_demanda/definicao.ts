// A definição do `encerrar_demanda`: a Fabriquinha integra a demanda e limpa o que sobrou, sem agente nem gate.
import { type DefinicaoDaEtapa, evidenciaExigida, SEM_CAPACIDADES } from "../definicao/definicao_da_etapa.ts";

export const DEFINICAO_DO_ENCERRAR_DEMANDA = {
  nome: "encerrar_demanda",
  objetivo: "Integrar a demanda e limpar o que sobrou, com a árvore de PRs, critérios e custos.",
  escopo: "demanda",
  executor: "fabriquinha",
  evidencias: [
    evidenciaExigida("encerrar_demanda", "arvore_prs_criterios_custos", "fabriquinha"),
    evidenciaExigida("encerrar_demanda", "demonstracao_limpeza", "fabriquinha", true, "nada_sobrou"),
  ],
  verificacoes: ["conferencia_do_pr"],
  metricas: ["uso"],
  capacidades: SEM_CAPACIDADES,
  exibicao: {
    rotulo: "Encerramento da demanda",
    acao: "Encerrar demanda",
    tituloPadrao: "Encerrar a demanda",
    nasMetricas: { titulo: "Encerrar demanda", modo: "Fabriquinha" },
    comoEstado: {
      rotulo: "Encerramento",
      tom: "rodando",
      colunaNoInicio: "Encerramento da demanda",
      colunaNoProjeto: "Encerramento da demanda",
    },
  },
  instrucao: new URL("encerrar_demanda.md", import.meta.url),
  papel: "integra_a_demanda",
} as const satisfies DefinicaoDaEtapa;

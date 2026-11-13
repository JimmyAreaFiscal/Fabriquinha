// A definição do `encerrar_rodada`: o agente documenta o PR, e a Fabriquinha o publica e confere para o gate do PR.
import { type DefinicaoDaEtapa, evidenciaExigida, EXTENSOES_DO_AGENTE } from "../definicao/definicao_da_etapa.ts";

export const DEFINICAO_DO_ENCERRAR_RODADA = {
  nome: "encerrar_rodada",
  objetivo: "Fechar a rodada: mensagem e aula do código, produtividade e PR aberto e conferido.",
  escopo: "rodada",
  executor: "agente_autonomo",
  evidencias: [
    evidenciaExigida("encerrar_rodada", "mensagem_pr", "agente"),
    evidenciaExigida("encerrar_rodada", "aula_codigo", "agente"),
    evidenciaExigida("encerrar_rodada", "relatorio_produtividade", "fabriquinha"),
    evidenciaExigida("encerrar_rodada", "pr_aberto", "fabriquinha"),
    evidenciaExigida("encerrar_rodada", "video_demonstracao", "agente", false),
  ],
  verificacoes: ["conferencia_do_pr"],
  metricas: ["uso", "nota_humana"],
  capacidades: {
    skills: ["artefato-mensagem-pr", "artefato-aula-codigo", "artefato-video-demonstracao"],
    extensoes: EXTENSOES_DO_AGENTE,
  },
  exibicao: {
    rotulo: "Encerramento da rodada",
    acao: "Encerrar rodada",
    tituloPadrao: "Encerrar a rodada",
    nasMetricas: { titulo: "Encerrar rodada", modo: "Gerenciado" },
    comoEstado: {
      rotulo: "Encerramento",
      tom: "rodando",
      colunaNoInicio: "Encerramento da rodada",
      colunaNoProjeto: "Encerramento",
    },
  },
  instrucao: new URL("encerrar_rodada.md", import.meta.url),
  gate: {
    nome: "gate_pr",
    rotulo: "aprovação do PR",
    decisor: "auditor",
    esperaEmEstadoProprio: true,
    reprovadoVaiPara: "ajustar_resultado",
  },
  devolvePara: "implementar",
  papel: "publica_o_pr_da_rodada",
} as const satisfies DefinicaoDaEtapa;

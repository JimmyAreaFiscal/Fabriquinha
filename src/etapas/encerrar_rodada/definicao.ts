// A definição do `encerrar_rodada`: o agente documenta o PR, e a Fabriquinha o publica e confere para o gate do PR.
import { type DefinicaoDaEtapa, evidenciaExigida, EXTENSOES_DO_AGENTE } from "../definicao/definicao_da_etapa.ts";
import { secaoDoPromptDoEncerrarRodada } from "./secao_do_prompt.ts";

export const DEFINICAO_DO_ENCERRAR_RODADA: DefinicaoDaEtapa = {
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
  instrucao: new URL("encerrar_rodada.md", import.meta.url),
  secaoDoPrompt: secaoDoPromptDoEncerrarRodada,
  gate: { nome: "gate_pr", decisor: "auditor", esperaEmEstadoProprio: true, reprovadoVaiPara: "ajustar_resultado" },
  devolvePara: "implementar",
  papel: "publica_o_pr_da_rodada",
};

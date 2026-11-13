// Regras de fronteira do domínio Sessões de IA (MELHORIAS §9); o motor (../motor.ts) explica os campos.
import type { RegrasDoDominio } from "../motor.ts";

/** As sessões de agente: o único que lança o pi e consulta o modelo. */
export const ARQUIVO_DO_CONDUTOR = "modulos/sessoes/execucao/aplicacao/sessoes_de_agente.ts";
/** O adapter pi, que implementa `.lancar(` e `.perguntar(`. */
export const ARQUIVO_DO_HARNESS = "modulos/sessoes/harness/infra/pi/harness_pi.ts";

export const REGRAS_DE_SESSOES: RegrasDoDominio = {
  dependeDe: ["ambiente"],
  subdominios: {
    // O harness recebe o modelo e o effort do lançamento e lista os modelos que conhece.
    harness: ["modelos"],
    modelos: [],
    historico: [],
    // O fim da execução grava o Uso dela na mesma unidade de trabalho, e os eventos vivos vão ao chat.
    execucao: ["harness", "historico", "chat", "metricas_de_execucao", "modelos"],
    chat: ["harness"],
    metricas_de_execucao: ["harness", "modelos"],
  },
  // O pi sem worktree fala com o host.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [ARQUIVO_DO_HARNESS],
    chamadoresDiretos: [ARQUIVO_DO_HARNESS],
  },
};

// Regras de fronteira do domínio Sessões de IA (MELHORIAS §9). Os tickets 08 e 09 mudam só este arquivo; o motor
// (../motor.ts) explica os campos e como declarar o domínio migrado.
import type { RegrasDoDominio } from "../motor.ts";

/** O condutor: o único que lança o pi e consulta o modelo. */
export const ARQUIVO_DO_CONDUTOR = "modulos/trabalho_agentico/aplicacao/trabalho/condutor.ts";
/** O adapter pi, que implementa `.lancar(` e `.perguntar(`. */
export const ARQUIVO_DO_HARNESS = "modulos/harness/pi/harness_pi.ts";

export const REGRAS_DE_SESSOES: RegrasDoDominio = {
  migrado: false,
  dependeDe: ["ambiente"],
  subdominios: {
    harness: [],
    modelos: [],
    historico: [],
    execucao: ["harness", "historico"],
    chat: ["harness", "historico"],
    metricas_de_execucao: ["harness", "modelos"],
  },
  posseDasTabelas: "inventario",
  excecoes: [],
  dependenciasToleradas: [],
  // O pi sem worktree fala com o host.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [ARQUIVO_DO_HARNESS],
    chamadoresDiretos: [ARQUIVO_DO_HARNESS],
  },
};

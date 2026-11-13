// Regras de fronteira do domínio Sessões de IA (MELHORIAS §9). Os tickets 08 e 09 mudam só este arquivo; o motor
// (../motor.ts) explica os campos e como declarar o domínio migrado.
import type { RegrasDoDominio } from "../motor.ts";

/** O condutor: o único que lança o pi e consulta o modelo. */
export const ARQUIVO_DO_CONDUTOR = "modulos/trabalho_agentico/aplicacao/trabalho/condutor.ts";
/** O adapter pi, que implementa `.lancar(` e `.perguntar(`. */
export const ARQUIVO_DO_HARNESS = "modulos/sessoes/harness/infra/pi/harness_pi.ts";

const IMPORTA_O_CODIGO_ANTIGO = "um domínio migrado não importa o código antigo";

export const REGRAS_DE_SESSOES: RegrasDoDominio = {
  migrado: true,
  dependeDe: ["ambiente"],
  subdominios: {
    // O harness recebe o modelo e o effort do lançamento e lista os modelos que conhece.
    harness: ["modelos"],
    modelos: [],
    historico: [],
    execucao: ["harness", "historico"],
    chat: ["harness", "historico"],
    metricas_de_execucao: ["harness", "modelos"],
  },
  posseDasTabelas: "inventario",
  // O Ambiente ainda não tem fachada (ticket 06): o harness lança o agente pelo Ambiente do código antigo.
  excecoes: [
    {
      arquivo: "modulos/sessoes/harness/nucleo/harness.ts",
      import: `../../../sandbox/infra/ambiente.ts (${IMPORTA_O_CODIGO_ANTIGO})`,
      ticket: "09",
    },
    {
      arquivo: "modulos/sessoes/harness/infra/pi/harness_pi.ts",
      import: `../../../../sandbox/infra/ambiente.ts (${IMPORTA_O_CODIGO_ANTIGO})`,
      ticket: "09",
    },
  ],
  dependenciasToleradas: [],
  // O pi sem worktree fala com o host.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [ARQUIVO_DO_HARNESS],
    chamadoresDiretos: [ARQUIVO_DO_HARNESS],
  },
};

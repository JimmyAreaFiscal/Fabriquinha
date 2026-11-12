// Regras de fronteira do domínio Demandas (MELHORIAS §12). Os tickets 18 e 19 mudam só este arquivo; o motor
// (../motor.ts) explica os campos e como declarar o domínio migrado.
import type { RegrasDoDominio } from "../motor.ts";

export const REGRAS_DE_DEMANDAS: RegrasDoDominio = {
  migrado: false,
  // Do Ciclo de Vida, só os tipos públicos de configuração, pela fachada.
  dependeDe: ["repositorio", "ciclo_de_vida"],
  subdominios: {
    projetos: [],
    pedidos: ["projetos"],
    dependencias: ["pedidos"],
  },
  posseDasTabelas: "inventario",
  excecoes: [],
  dependenciasToleradas: [],
  processoDoHost: { pastasLiberadas: [], importamChildProcess: [], chamadoresDiretos: [] },
};

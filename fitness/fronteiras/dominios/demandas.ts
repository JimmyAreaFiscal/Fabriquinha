// Regras de fronteira do domínio Demandas (MELHORIAS §12), migrado no ticket 18: src/modulos/demandas/ tem a fachada
// publico.ts e os subdomínios Projetos (18), Pedidos e Dependências (19). O motor (../motor.ts) explica os campos.
import type { RegrasDoDominio } from "../motor.ts";

export const REGRAS_DE_DEMANDAS: RegrasDoDominio = {
  migrado: true,
  // Do Ciclo de Vida, só os tipos públicos de configuração, pela fachada.
  dependeDe: ["repositorio", "ciclo_de_vida"],
  subdominios: {
    projetos: [],
    pedidos: ["projetos"],
    dependencias: ["pedidos"],
  },
  posseDasTabelas: "estrita",
  excecoes: [],
  dependenciasToleradas: [],
  processoDoHost: { pastasLiberadas: [], importamChildProcess: [], chamadoresDiretos: [] },
};

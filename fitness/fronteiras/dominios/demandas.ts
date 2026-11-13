// Regras de fronteira do domínio Demandas (MELHORIAS §12): a fachada publico.ts e os subdomínios Projetos e Pedidos
// (que absorveu as Dependências e monta a GestaoDeDemandas). O motor (../motor.ts) explica os campos.
import type { RegrasDoDominio } from "../motor.ts";

export const REGRAS_DE_DEMANDAS: RegrasDoDominio = {
  // Do Ciclo de Vida, só a configuração do agente (os tipos e o mapeador das colunas), pela fachada; do Repositório, a
  // hospedagem, a conferência e a forma do identificador da demanda.
  dependeDe: ["repositorio", "ciclo_de_vida"],
  subdominios: {
    projetos: [],
    pedidos: ["projetos"],
  },
  processoDoHost: { pastasLiberadas: [], importamChildProcess: [], chamadoresDiretos: [] },
};

// A API de Métricas de Qualidade (MELHORIAS §11): calcula os indicadores a partir dos fatos, por Etapa, demanda, projeto
// e período. Não tem tabela: cada Métrica lê os fatos dela em lote, de Planejamento, Processo e Evidências e das fachadas
// de Sessões e Repositório, e os pedidos chegam como dado de quem pede.
export type { PedidoDasMetricas } from "./nucleo/metrica.ts";
export { Periodo } from "./nucleo/periodo.ts";
export { produtividadeDaRodada, type ProdutividadeRodada } from "./nucleo/produtividade_rodada.ts";
export {
  metricasDasDemandasDoPeriodo,
  metricasDosMeses,
  type MetricasDoMes,
  type MetricasPorDemanda,
  usoDaDemanda,
} from "./aplicacao/metricas_do_periodo.ts";

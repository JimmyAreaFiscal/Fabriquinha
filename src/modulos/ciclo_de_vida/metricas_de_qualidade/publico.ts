// A API de Métricas de Qualidade (MELHORIAS §11): calcula as métricas do processo a partir dos fatos, por Etapa, demanda,
// projeto e período. Não tem tabela: cada Métrica lê os fatos dela em lote, de Planejamento, Processo e Evidências e do
// Repositório, e os pedidos chegam como dado de quem pede.
export type { DefinicaoDaMetrica, PedidoDasMetricas, Recorte } from "./nucleo/metrica.ts";
export { Periodo } from "./nucleo/periodo.ts";
export { produtividadeDaRodada, type ProdutividadeRodada } from "./nucleo/produtividade_rodada.ts";
export {
  DEMANDA_DO_FATO,
  type ParteDoFato,
  type ValorDaMetrica,
  type ValoresPorParte,
} from "./aplicacao/calculo_de_metrica.ts";
export type { OrigemDosFatos } from "./aplicacao/leitura_dos_fatos.ts";
export { metricasDoCicloDeVida, type MetricasDoProcesso } from "./aplicacao/metricas_do_processo.ts";

// Rotas das métricas (F7 §4.2): a visão por mês, com as Métricas de cada Etapa, e a por demanda, lidas das tabelas da demanda, num período de no máximo 24 meses.
import { consultarMetricasDasDemandas, consultarMetricasDosMeses } from "./consulta_metricas.ts";
import { FiltroDeMetricas, MetricasDasDemandas, MetricasDosMeses } from "../contrato/metricas.ts";
import type { Rota } from "../rotas.ts";

const filtro = (query: URLSearchParams) => FiltroDeMetricas.parse(Object.fromEntries(query));

export const ROTAS_DAS_METRICAS: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/metricas",
    tratar: ({ banco, cicloDeVida, demandas, query, relogio }) =>
      consultarMetricasDosMeses(banco, cicloDeVida, demandas, filtro(query), relogio),
    resposta: MetricasDosMeses,
  },
  {
    metodo: "GET",
    caminho: "/api/metricas/demandas",
    tratar: ({ banco, cicloDeVida, demandas, query, relogio }) =>
      consultarMetricasDasDemandas(banco, cicloDeVida, demandas, filtro(query), relogio),
    resposta: MetricasDasDemandas,
  },
];

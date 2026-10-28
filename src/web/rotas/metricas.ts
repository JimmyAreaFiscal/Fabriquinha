// Rotas das métricas (F7 §4.2): a visão por mês e a por demanda, lidas das tabelas da demanda, num período de no máximo 24 meses.
import { z } from "zod";
import { Slug } from "../../dominio/primitivos.ts";
import { Mes, mesDe, somarMeses } from "../../metricas/periodo.ts";
import { metricasDemandaPorMes, metricasPorDemanda } from "../../metricas/periodo_demanda.ts";
import type { Rota } from "../rotas.ts";

/** Sem `ate`, o mês corrente no fuso do serviço; sem `de`, os 11 meses antes de `ate`; sem `projeto`, todos. */
const Filtro = z
  .object({ projeto: Slug.optional(), de: Mes.optional(), ate: Mes.optional() })
  .transform(({ projeto, ate = mesDe(new Date()), de = somarMeses(ate, -11) }) => ({ projeto, de, ate }))
  .refine((p) => p.de <= p.ate, "`de` não pode ser depois de `ate`")
  .refine((p) => p.ate <= somarMeses(p.de, 23), "o período tem no máximo 24 meses");

const filtro = (query: URLSearchParams) => Filtro.parse(Object.fromEntries(query));

export const ROTAS_DAS_METRICAS: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/metricas",
    tratar: ({ banco, query }) => metricasDemandaPorMes(banco, filtro(query)),
  },
  {
    metodo: "GET",
    caminho: "/api/metricas/issues", // o caminho antigo: a rota é a mesma, as linhas são demandas
    tratar: ({ banco, query }) => metricasPorDemanda(banco, filtro(query)),
  },
];

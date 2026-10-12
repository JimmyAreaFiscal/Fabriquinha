// Rotas das métricas (F7 §4.2): a visão por mês e a por issue do F6 num período de no máximo 24 meses.
import { z } from "zod";
import { Slug } from "../../dominio/primitivos.ts";
import { Mes, metricasPorIssue, metricasPorMes } from "../../metricas/periodo.ts";
import { contarMeses, mesDe, somarMeses } from "../cliente/telas/metricas.ts";
import type { Rota } from "../rotas.ts";

/** Sem `ate`, o mês corrente no fuso do serviço; sem `de`, os 11 meses antes de `ate`; sem `projeto`, todos. */
const Filtro = z
  .object({ projeto: Slug.optional(), de: Mes.optional(), ate: Mes.optional() })
  .transform(({ projeto, ate = mesDe(new Date()), de = somarMeses(ate, -11) }) => ({ projeto, de, ate }))
  .refine((p) => p.de <= p.ate, "`de` não pode ser depois de `ate`")
  .refine((p) => contarMeses(p.de, p.ate) <= 24, "o período tem no máximo 24 meses");

const filtro = (query: URLSearchParams) => Filtro.parse(Object.fromEntries(query));

export const ROTAS_DAS_METRICAS: Rota[] = [
  { metodo: "GET", caminho: "/api/metricas", tratar: ({ banco, query }) => metricasPorMes(banco, filtro(query)) },
  {
    metodo: "GET",
    caminho: "/api/metricas/issues",
    tratar: ({ banco, query }) => metricasPorIssue(banco, filtro(query)),
  },
];

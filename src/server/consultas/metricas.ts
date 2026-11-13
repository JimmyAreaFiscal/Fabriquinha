// As consultas da tela de Métricas: as duas visões do período, lidas num snapshot só. O mês corrente vem do relógio.
import type { DatabaseSync } from "node:sqlite";
import { somarMeses } from "../../shared/nucleo/periodo.ts";
import { mesDoInstante, type Relogio } from "../../modulos/compartilhado/nucleo/relogio.ts";
import { lerEmSnapshot } from "../../modulos/compartilhado/armazenamento/snapshot.ts";
import type { FiltroDeMetricas } from "../contrato/metricas.ts";
import { metricasDasDemandasDoPeriodo, metricasDosMeses, Periodo } from "../../modulos/ciclo_de_vida/publico.ts";
import { lerPedidosDasMetricas } from "./demandas/pedidos_das_metricas.ts";

const PeriodoDasMetricas = Periodo.refine((p) => p.ate <= somarMeses(p.de, 23), "o período tem no máximo 24 meses");

/** Sem `ate`, o mês corrente no fuso do serviço; sem `de`, os 11 meses antes de `ate`; sem `projeto`, todos. */
function periodoDoFiltro({ projeto, ate, de }: FiltroDeMetricas, relogio: Relogio) {
  const fim = ate ?? mesDoInstante(relogio.agora());
  return PeriodoDasMetricas.parse({ projeto, de: de ?? somarMeses(fim, -11), ate: fim });
}

/** As Métricas de cada Etapa e os fatos de cada mês do período do `filtro`. */
export const consultarMetricasDosMeses = (banco: DatabaseSync, filtro: FiltroDeMetricas, relogio: Relogio) =>
  lerEmSnapshot(banco, () =>
    metricasDosMeses({ banco, pedidos: lerPedidosDasMetricas(banco) }, periodoDoFiltro(filtro, relogio)),
  );

/** Uma linha por demanda com execução no período do `filtro`, mais o rodapé. */
export const consultarMetricasDasDemandas = (banco: DatabaseSync, filtro: FiltroDeMetricas, relogio: Relogio) =>
  lerEmSnapshot(banco, () =>
    metricasDasDemandasDoPeriodo({ banco, pedidos: lerPedidosDasMetricas(banco) }, periodoDoFiltro(filtro, relogio)),
  );

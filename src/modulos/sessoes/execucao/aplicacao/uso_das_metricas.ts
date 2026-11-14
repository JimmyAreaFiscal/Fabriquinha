// A métrica "uso" (MELHORIAS §11, decisão 6 da migração das interfaces): o Uso de cada Trabalho Agêntico das demandas
// pedidas, a execução do período e a sessão externa declarada. O contexto (demanda, ticket) vai como veio; quem agrupa
// por Etapa, mês ou demanda é quem pede.
import type { DatabaseSync } from "node:sqlite";
import type { DemandaId } from "../../../../shared/nucleo/demanda/demanda_id.ts";
import {
  lerUsoDasExecucoes,
  lerUsoDeclaradoEmLote,
  linhaDeUsoDaExecucao,
  Uso,
} from "../../metricas_de_execucao/publico.ts";
import { execucoesEmLote } from "../armazenamento/sessoes_e_execucoes.ts";
import type { IdDaExecucao } from "../nucleo/sessao.ts";

/** As demandas e o período `[inicio, fim)` do início das execuções; a ponta ausente não restringe. */
export interface PedidoDasMetricasDeUso {
  demandas: readonly DemandaId[];
  periodo: { inicio?: string; fim?: string };
}

/** O Uso do pedido: cada execução é um Trabalho, e cada sessão externa declarada, outro. */
export interface UsoPorContexto {
  /** As execuções iniciadas no período, na ordem do início. */
  execucoes: ReturnType<typeof execucoesEmLote>;
  /** O Uso medido de cada execução que tem algum, na ordem em que foi gravado: a ordem das somas. */
  usoPorExecucao: ReadonlyMap<IdDaExecucao, Uso>;
  /** Cada sessão externa declarada das demandas, de qualquer período (a declaração não tem data), na ordem gravada. */
  declarados: { demanda_id: DemandaId; ferramenta: string; sessao: string; uso: Uso }[];
}

export function usoDasMetricas(banco: DatabaseSync, { demandas, periodo }: PedidoDasMetricasDeUso): UsoPorContexto {
  const execucoes = execucoesEmLote(banco, { demandas, periodo });
  const linhasPorExecucao = Map.groupBy(
    lerUsoDasExecucoes(
      banco,
      execucoes.map((execucao) => execucao.id),
    ),
    (uso) => uso.execucao_id,
  );
  return {
    execucoes,
    usoPorExecucao: new Map(
      [...linhasPorExecucao].map(([execucao, usos]) => [execucao, Uso.de(usos.map(linhaDeUsoDaExecucao), 1)]),
    ),
    declarados: lerUsoDeclaradoEmLote(banco, demandas).map(({ demanda_id, ferramenta, sessao, linhas }) => ({
      demanda_id,
      ferramenta,
      sessao,
      uso: Uso.de(linhas, 1),
    })),
  };
}

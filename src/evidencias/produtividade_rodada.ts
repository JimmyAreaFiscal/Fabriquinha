// Relatório de produtividade da rodada: consumo por ticket e total (comparacao-sdlc-implementacao.md §7.3).
// Custo ausente não é zero: o ticket sem custo medido é incompleto e o total de custo vira piso.
import type { TicketDemanda } from "../dominio/agregado_demanda.ts";
import {
  totalDoTicket,
  type ExecucaoSessao,
  type Sessao,
  type TotalUso,
  type UsoModeloExecucao,
} from "../dominio/sessoes.ts";
import { formatarTicketRef } from "../dominio/demanda.ts";

export interface ConsumoRodada {
  execucoes: number;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  tokensCacheEscrita: number;
  /** Soma só dos custos conhecidos; com `custoIncompleto` é um piso. */
  custo: number;
  custoIncompleto: boolean;
}
export interface TicketProduzido extends ConsumoRodada {
  ticket: string;
  etapa: string;
}
export interface ProdutividadeRodada {
  tickets: TicketProduzido[];
  total: ConsumoRodada;
}

const consumo = (t: TotalUso, execucoes: number): ConsumoRodada => ({
  execucoes,
  tokensEntrada: t.tokens_entrada,
  tokensSaida: t.tokens_saida,
  tokensCacheLeitura: t.tokens_cache_leitura,
  tokensCacheEscrita: t.tokens_cache_escrita,
  custo: t.custo_conhecido,
  custoIncompleto: t.custo_incompleto,
});

export function produtividadeDaRodada(
  sessoes: readonly Sessao[],
  execucoes: readonly ExecucaoSessao[],
  usos: readonly UsoModeloExecucao[],
  tickets: readonly TicketDemanda[],
): ProdutividadeRodada {
  const porTicket = tickets.map((t): TicketProduzido => {
    const ids = new Set(
      sessoes.filter((s) => s.demanda_id === t.demanda_id && s.ticket_id === t.ticket_id).map((s) => s.id),
    );
    const execs = new Set(execucoes.filter((e) => ids.has(e.sessao_id)).map((e) => e.id));
    const total = totalDoTicket(sessoes, execucoes, usos, t);
    // Sem nenhum uso registrado não há custo medido: nunca vale zero.
    const semMedida = !usos.some((u) => execs.has(u.execucao_id));
    return {
      ticket: formatarTicketRef(t),
      etapa: t.etapa,
      ...consumo({ ...total, custo_incompleto: total.custo_incompleto || semMedida }, execs.size),
    };
  });
  const soma = (campo: Exclude<keyof ConsumoRodada, "custoIncompleto">) => porTicket.reduce((n, t) => n + t[campo], 0);
  return {
    tickets: porTicket,
    total: {
      execucoes: soma("execucoes"),
      tokensEntrada: soma("tokensEntrada"),
      tokensSaida: soma("tokensSaida"),
      tokensCacheLeitura: soma("tokensCacheLeitura"),
      tokensCacheEscrita: soma("tokensCacheEscrita"),
      custo: soma("custo"),
      custoIncompleto: porTicket.some((t) => t.custoIncompleto),
    },
  };
}

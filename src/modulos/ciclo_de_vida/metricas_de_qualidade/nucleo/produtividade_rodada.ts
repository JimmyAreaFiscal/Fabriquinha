// Relatório de produtividade da rodada: consumo por ticket e total (comparacao-sdlc-implementacao.md §7.3).
// Custo ausente não é zero: o ticket sem custo medido é incompleto e o total de custo vira piso.
import { type LinhaDeUso, Uso, type UsoPorContexto } from "../../../sessoes/publico.ts";
import { formatarTicketRef } from "../../etapas/publico.ts";

/** O ticket da rodada, só com o que o relatório mostra. */
interface TicketDaRodada {
  demanda_id: string;
  ticket_id: number;
  etapa: string;
}

interface ConsumoRodada {
  execucoes: number;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCacheLeitura: number;
  tokensCacheEscrita: number;
  /** Soma só dos custos conhecidos; com `custoIncompleto` é um piso. */
  custo: number;
  custoIncompleto: boolean;
}
interface TicketProduzido extends ConsumoRodada {
  ticket: string;
  etapa: string;
}
export interface ProdutividadeRodada {
  tickets: TicketProduzido[];
  total: ConsumoRodada;
}

const consumo = (uso: Uso, execucoes: number, semMedida: boolean): ConsumoRodada => {
  const linhas = uso.porModelo();
  const tokens = (campo: keyof LinhaDeUso & `tokens_${string}`) => linhas.reduce((n, l) => n + l[campo], 0);
  const { conhecido, trabalhosSemCusto } = uso.custo();
  return {
    execucoes,
    tokensEntrada: tokens("tokens_entrada"),
    tokensSaida: tokens("tokens_saida"),
    tokensCacheLeitura: tokens("tokens_cache_leitura"),
    tokensCacheEscrita: tokens("tokens_cache_escrita"),
    custo: conhecido,
    custoIncompleto: semMedida || trabalhosSemCusto > 0,
  };
};

/**
 * As execuções das demandas, com o contexto, e o Uso medido de cada uma: a métrica "uso" de Sessões.
 * @testes o teste monta a entrada com este tipo
 */
export type UsoDasExecucoes = Pick<UsoPorContexto, "execucoes" | "usoPorExecucao">;

export function produtividadeDaRodada(
  { execucoes, usoPorExecucao }: UsoDasExecucoes,
  tickets: readonly TicketDaRodada[],
): ProdutividadeRodada {
  const consumos = tickets.map((t) => {
    const execs = new Set(
      execucoes.filter((e) => e.demanda_id === t.demanda_id && e.ticket_id === t.ticket_id).map((e) => e.id),
    );
    // Na ordem em que o Uso foi gravado: é a ordem das somas.
    const usosDoTicket = [...usoPorExecucao].filter(([execucao]) => execs.has(execucao)).map(([, uso]) => uso);
    return {
      ticket: formatarTicketRef(t),
      etapa: t.etapa,
      execucoes: execs.size,
      uso: usosDoTicket.reduce((soma, uso) => soma.somar(uso), Uso.vazio()),
      // Sem nenhum uso registrado não há custo medido: nunca vale zero.
      semMedida: usosDoTicket.length === 0,
    };
  });
  return {
    tickets: consumos.map((t): TicketProduzido => ({
      ticket: t.ticket,
      etapa: t.etapa,
      ...consumo(t.uso, t.execucoes, t.semMedida),
    })),
    total: consumo(
      consumos.reduce((soma, t) => soma.somar(t.uso), Uso.vazio()),
      consumos.reduce((n, t) => n + t.execucoes, 0),
      consumos.some((t) => t.semMedida),
    ),
  };
}

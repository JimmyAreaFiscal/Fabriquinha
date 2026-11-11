// Relatório de produtividade da rodada: consumo por ticket e total (comparacao-sdlc-implementacao.md §7.3).
// Custo ausente não é zero: o ticket sem custo medido é incompleto e o total de custo vira piso.
import type { TicketDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { Uso, type LinhaDeUso } from "../nucleo/uso.ts";
import {
  registrarUso,
  type ProcessoDoTrabalho,
  type TrabalhoGerenciado,
  type UsoModeloExecucao,
} from "../../execucao/nucleo/trabalho_agentico.ts";
import { formatarTicketRef } from "../../demanda/nucleo/demanda.ts";

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
  const tokens = (campo: Exclude<keyof LinhaDeUso, "modelo" | "custo" | "chamadas">) =>
    linhas.reduce((n, l) => n + l[campo], 0);
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

// O banco não guarda as chamadas do uso medido, por isso 0.
const linhaDeUso = (u: UsoModeloExecucao): LinhaDeUso => ({
  modelo: `${u.modelo_provedor}/${u.modelo_nome}`,
  tokens_entrada: u.tokens_entrada,
  tokens_saida: u.tokens_saida,
  tokens_cache_leitura: u.tokens_cache_leitura,
  tokens_cache_escrita: u.tokens_cache_escrita,
  custo: u.custo ?? null,
  chamadas: 0,
});

export function produtividadeDaRodada(
  sessoes: readonly TrabalhoGerenciado[],
  execucoes: readonly ProcessoDoTrabalho[],
  usos: readonly UsoModeloExecucao[],
  tickets: readonly TicketDemanda[],
): ProdutividadeRodada {
  // Cada chave (execução, modelo) conta uma vez, mesmo em sessões retomadas.
  const usosUnicos = usos.reduce<UsoModeloExecucao[]>((acc, u) => registrarUso(acc, u), []);
  const consumos = tickets.map((t) => {
    const ids = new Set(
      sessoes.filter((s) => s.demanda_id === t.demanda_id && s.ticket_id === t.ticket_id).map((s) => s.id),
    );
    const execs = new Set(execucoes.filter((e) => ids.has(e.trabalho_id)).map((e) => e.id));
    const usosDoTicket = usosUnicos.filter((u) => execs.has(u.execucao_id));
    return {
      ticket: formatarTicketRef(t),
      etapa: t.etapa,
      execucoes: execs.size,
      uso: Uso.de(usosDoTicket.map(linhaDeUso), 1),
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

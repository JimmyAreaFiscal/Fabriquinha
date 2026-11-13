// O contexto do prompt do ticket: o que o motor junta para a montagem do prompt, que é de cada Etapa, quando lança o
// agente dela. Só dados, sem I/O.
import type { AgregadoDemanda, RetornoAoAgente, TicketDemanda } from "../../../processo/publico.ts";

/** Um anexo de evidência da demanda com o caminho do arquivo no disco, que o agente lê direto. */
export interface AnexoNoDisco {
  nome: string;
  caminho: string;
  tipo: string;
  rodada_id?: number;
  ticket_id?: number;
}

export interface ContextoDoPrompt {
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  projeto: { nome: string; branch_base: string };
  worktree: string;
  saida: string;
  retomada?: RetornoAoAgente;
  /** Os anexos das evidências da demanda: a seção da etapa dá o caminho dos que o agente precisa ler. */
  anexos: readonly AnexoNoDisco[];
  /** As perguntas respondidas na sessão de cada ticket (por `ticket_id`); a seção de revisões anteriores as lista. */
  perguntasDasRevisoesAnteriores?: ReadonlyMap<number, readonly { pergunta: string; resposta: string }[]>;
  /** O SHA do commit de cada ticket que a Fabriquinha commitou (por `ticket_id`); as revisões leem o que já foi verificado nele. */
  commitsDosTickets?: ReadonlyMap<number, string>;
}

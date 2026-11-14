// O esquecimento das demandas de um projeto removido (I-4): a recusa da execução em andamento vem antes das remoções dos
// outros módulos, e a remoção do desenvolvimento, depois delas, na ordem das chaves estrangeiras.
import type { DatabaseSync } from "node:sqlite";
import type { SessoesDeAgente } from "../../../sessoes/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { formatarTicketRef } from "../../etapas/publico.ts";
import { ticketsDasDemandas } from "../../planejamento/publico.ts";
import { apagarDesenvolvimentoDasDemandas } from "../../processo/publico.ts";

/** Recusa se um ticket das `demandas` está em execução ou tem execução de sessão aberta; devolve a remoção adiada. */
export function esquecimentoDasDemandas(
  banco: DatabaseSync,
  sessoes: SessoesDeAgente,
  projeto: string,
  demandas: readonly string[],
): () => string[] {
  const comExecucaoAberta = new Set(
    sessoes
      .listar({ demandas, abertas: true })
      .map(({ demanda_id, ticket_id }) => `${demanda_id}.${String(ticket_id)}`),
  );
  const ticketEmAndamento = ticketsDasDemandas(banco, demandas).find(
    (ticket) =>
      ticket.estado === "em_execucao" || comExecucaoAberta.has(`${ticket.demanda_id}.${String(ticket.ticket_id)}`),
  );
  if (ticketEmAndamento) {
    throw new ErroDeRegra(
      `o projeto ${projeto} tem execução em andamento no ${formatarTicketRef(ticketEmAndamento)}`,
      "espere ela terminar ou pare a sessão, e remova de novo",
    );
  }
  return () => apagarDesenvolvimentoDasDemandas(banco, demandas);
}

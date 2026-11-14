// O pi vivo da sessão de uma etapa interativa (o planejar e o ajustar_resultado): vive ocioso entre do
// Auditor, e a Decisão do gate ou a conclusão da sessão o encerra.
import type { DatabaseSync } from "node:sqlite";
import { montarSessoesDeAgente, type Situacao } from "../../../../sessoes/publico.ts";

interface Ticket {
  demanda_id: string;
  ticket_id: number;
}

/** O pi vivo da última sessão do ticket, se há. */
function piVivoDoTicket(banco: DatabaseSync, ticket: Ticket): Situacao | undefined {
  return montarSessoesDeAgente({ banco })
    .listar({ demandas: [ticket.demanda_id] })
    .filter((s) => s.ticket_id === ticket.ticket_id)
    .at(-1)?.situacao;
}

/** Manda `mensagem` como prompt ao pi vivo e ocioso da sessão do ticket; ocupado ou sem pi vivo, não manda. */
export function mandarAoPiVivoOcioso(banco: DatabaseSync, ticket: Ticket, mensagem: string): void {
  const viva = piVivoDoTicket(banco, ticket);
  if (viva && !viva.ocupado) {
    montarSessoesDeAgente({ banco }).mandar(String(viva.execucao), { type: "prompt", message: mensagem });
  }
}

/** Encerra o pi vivo da sessão do ticket, se há: a execução ganha o fim. */
export function encerrarPiVivo(banco: DatabaseSync, ticket: Ticket): void {
  const viva = piVivoDoTicket(banco, ticket);
  if (viva) void montarSessoesDeAgente({ banco }).encerrar(String(viva.execucao));
}

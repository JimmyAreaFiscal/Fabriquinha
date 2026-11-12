// O pi vivo da sessão de uma etapa interativa (o planejar e o ajustar_resultado): vive ocioso entre as mensagens do
// Auditor, e a Decisão do gate ou a conclusão da sessão o encerra.
import type { DatabaseSync } from "node:sqlite";
import { carregarTrabalhosDoTicket } from "../../trabalho_agentico/armazenamento/trabalho_agentico.ts";
import { condutor } from "../../trabalho_agentico/aplicacao/trabalho/condutor.ts";

interface Ticket {
  demanda_id: string;
  ticket_id: number;
}

/** O pi vivo da última sessão do ticket, se há. */
function piVivoDoTicket(banco: DatabaseSync, ticket: Ticket): ReturnType<typeof condutor.situacao> {
  const atual = carregarTrabalhosDoTicket(banco, ticket).sessoes.at(-1);
  return atual && condutor.situacao(atual.id);
}

/** Manda `mensagem` como prompt ao pi vivo e ocioso da sessão do ticket; ocupado ou sem pi vivo, não manda. */
export function mandarAoPiVivoOcioso(banco: DatabaseSync, ticket: Ticket, mensagem: string): void {
  const viva = piVivoDoTicket(banco, ticket);
  if (viva && !viva.ocupado) condutor.mandar(viva.execucao, { type: "prompt", message: mensagem });
}

/** Encerra o pi vivo da sessão do ticket, se há: a execução ganha o fim. */
export function encerrarPiVivo(banco: DatabaseSync, ticket: Ticket): void {
  const viva = piVivoDoTicket(banco, ticket);
  if (viva) condutor.encerrar(viva.execucao);
}

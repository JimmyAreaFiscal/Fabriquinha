// Quem pode agir em qual ticket é política da Condução, não de Sessões.
// O agente só age no próprio ticket: o Ator `agente` traz só o `trabalho_id` (o `processo_do_trabalho.id`), então o núcleo não
// sabe de quem é o trabalho. Quem grava a ação de um agente (decisão, evidência, ticket corretivo) chama esta conferência.
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import { type Ator, formatarTicketRef, type TicketRef } from "../../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { montarSessoesDeAgente } from "../../../../sessoes/publico.ts";

/** Recusa o agente cujo trabalho não é uma execução do `ticket`; os demais atores passam (o núcleo confere o tipo). */
export function exigirTrabalhoDoTicket(banco: DatabaseSync, ator: Ator, ticket: z.infer<typeof TicketRef>): void {
  if (ator.tipo !== "agente") return;
  const [dono] = montarSessoesDeAgente({ banco }).listar({ execucoes: [ator.trabalho_id] });
  if (dono?.demanda_id === ticket.demanda_id && dono.ticket_id === ticket.ticket_id) return;
  throw new ErroDeRegra(
    `o trabalho ${ator.trabalho_id} não é uma execução do ticket ${formatarTicketRef(ticket)}`,
    "o agente só age no próprio ticket",
  );
}

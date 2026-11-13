// A Tentativa que abre no início da execução do ticket. A transição ainda mora no sdlc, como as outras do agregado
// (ticket 22); a reserva do ticket mudou para o Despacho.
import { z } from "zod";
import { type Ator, exigirAtor } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import type { AgregadoDemanda } from "../demanda/agregado_demanda.ts";
import { formatarTicketRef } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts";
import { CICLO_DO_TICKET } from "../ciclo_de_vida/ciclos.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { Id } from "../../../compartilhado/nucleo/primitivos.ts";
import { comTentativaAberta } from "../tentativa.ts";
import { type ContextoDemanda, ticketDaDemanda } from "../transicoes/transicoes_demanda.ts";

// provisório: remover no ticket 22 (a reserva mudou para src/modulos/ciclo_de_vida/despacho/nucleo/reserva_ticket.ts)
export { reservarTicket } from "../../../ciclo_de_vida/despacho/nucleo/reserva_ticket.ts";

const EntradaInicioDaTentativa = z.strictObject({ ticket_id: Id, processo_id: z.string().min(1) });

/**
 * Só a Fabriquinha, só ticket em andamento (o da sessão de ajustes nunca sai de `aberto`): a execução que começa abre a
 * Tentativa do ticket, guardando o processo dela. Execução retomada na Tentativa que já está aberta (a sessão
 * interativa) não abre outra.
 */
export function iniciarTentativaDoTicket(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "iniciar a Tentativa do ticket", "fabriquinha");
  const { ticket_id, processo_id } = EntradaInicioDaTentativa.parse(entrada);
  const ticket = ticketDaDemanda(ag, ticket_id);
  if (!CICLO_DO_TICKET.estaEmAndamento(ticket.estado)) {
    throw new ErroDeRegra(
      `o ticket ${formatarTicketRef(ticket)} está ${ticket.estado} e não executa`,
      "só se executa ticket aberto ou em execução",
    );
  }
  return { ...ag, tentativas: comTentativaAberta(ag.tentativas, ticket, processo_id, ctx.agora) };
}

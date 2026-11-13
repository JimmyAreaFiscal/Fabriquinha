// O início da execução do ticket: a reserva, que o leva de aberto a em_execucao com a seleção do Despacho como guarda, e a
// Tentativa que abre quando a execução começa.
import { z } from "zod";
import { type Ator, exigirAtor, formatarTicketRef } from "../../../etapas/publico.ts";
import type { AgregadoDemanda, TicketDemanda } from "../agregado/agregado_demanda.ts";
import { CICLO_DO_TICKET } from "../ciclos/ciclos.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { Id } from "../../../../../shared/nucleo/primitivos.ts";
import { comTentativaAberta } from "../tentativa.ts";
import {
  type ContextoDemanda,
  exigirDemandaEmAndamento,
  mudarTicket,
  ticketDaDemanda,
} from "../transicoes/transicoes_demanda.ts";

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

const EntradaReserva = z.strictObject({ ticket_id: Id });

/**
 * CA-1 a CA-7: só a Fabriquinha reserva, e só o ticket aberto da demanda em andamento que `exigirSelecao` deixa passar
 * (a seleção é do Despacho); vira `em_execucao`.
 */
export function reservarTicketAberto(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
  exigirSelecao: (ag: AgregadoDemanda, ticket: TicketDemanda) => void,
): AgregadoDemanda {
  exigirAtor(ator, "reservar o ticket", "fabriquinha");
  const { ticket_id } = EntradaReserva.parse(entrada);
  exigirDemandaEmAndamento(ag, "reservar");
  const ticket = ticketDaDemanda(ag, ticket_id);
  CICLO_DO_TICKET.exigir(ticket, "aberto");
  exigirSelecao(ag, ticket);
  return mudarTicket(ag, ticket, "em_execucao", ctx.agora);
}

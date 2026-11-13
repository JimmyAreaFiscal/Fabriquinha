// A reserva do ticket (MELHORIAS §5.2, regra 6): aberto → em_execucao, só se o Despacho o seleciona. É a mesma para o
// ciclo do agendador e para o "Executar agora"; a aplicação a roda na unidade de trabalho que lê o agregado.
import { z } from "zod";
import { type Ator, Endereco, exigirAtor, formatarTicketRef } from "../../etapas/publico.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { CICLO_DO_TICKET } from "../../processo/publico.ts";
import { Despacho, motivoDeRecusaDoItem, type ResultadoDoDespacho, situacaoDeUmaDemanda } from "./despacho.ts";
import { ErroDeRegra, existe } from "../../../../shared/nucleo/erros.ts";
import { Id } from "../../../../shared/nucleo/primitivos.ts";
import {
  type ContextoDemanda,
  exigirDemandaEmAndamento,
  mudarTicket,
  ticketDaDemanda,
} from "../../../sdlc/nucleo/transicoes/transicoes_demanda.ts";

const EntradaReserva = z.strictObject({ ticket_id: Id });

/** Por que o Despacho não escolheu o ticket: o motivo da recusa dele ou, sem recusa, quem vem antes dele. */
function impedimento(
  ag: AgregadoDemanda,
  t: TicketDemanda,
  { prontos, recusas }: ResultadoDoDespacho,
): [string, string] {
  const ref = (ticket_id: number) => formatarTicketRef({ demanda_id: ag.demanda.id, ticket_id });
  const recusa = motivoDeRecusaDoItem(recusas, Endereco.doTicket(ag.demanda.id, t.ticket_id));
  if (recusa?.tipo === "dependencia_pendente") {
    const ticketPendente = recusa.aguarda.find((x) => x.ticket_id !== undefined);
    if (ticketPendente)
      return [`depende do ticket ${String(ticketPendente)}, ainda não concluído`, "espere a conclusão dele"];
    const rodadaPendente = recusa.aguarda.find((x) => x.rodada_id !== undefined);
    if (rodadaPendente) {
      return [`a rodada ${String(rodadaPendente)} da qual a sua depende não foi concluída`, "espere a conclusão dela"];
    }
    return ["as predecessoras da demanda ainda não foram satisfeitas", "espere as predecessoras serem satisfeitas"];
  }
  if (recusa?.tipo === "ocupado") {
    const ocupante = existe(
      ag.tickets.find((x) => ref(x.ticket_id) === String(recusa.por)),
      `o ticket ${String(recusa.por)} não existe`,
      "confira o endereço do ticket",
    );
    const onde = ocupante.rodada_id === undefined ? "da demanda" : "da rodada";
    return [`o ticket ${ref(ocupante.ticket_id)} ${onde} está ${ocupante.estado}`, "espere ele ser resolvido"];
  }
  const escolhido = prontos.find((x) => x.etapa === t.etapa && x.rodada_id === t.rodada_id);
  if (escolhido) return [`o ticket ${ref(escolhido.ticket_id)} aberto vem antes`, "reserve o de menor id"];
  return [`a etapa ${t.etapa} não é a do trabalho do estado ${ag.demanda.estado}`, "só o trabalho elegível do estado"];
}

/** CA-1 a CA-7: só a Fabriquinha reserva, e só o ticket aberto que o Despacho seleciona; vira `em_execucao`. */
export function reservarTicket(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
  predecessorasSatisfeitas: boolean,
): AgregadoDemanda {
  exigirAtor(ator, "reservar o ticket", "fabriquinha");
  const { ticket_id } = EntradaReserva.parse(entrada);
  exigirDemandaEmAndamento(ag, "reservar");
  const ticket = ticketDaDemanda(ag, ticket_id);
  CICLO_DO_TICKET.exigir(ticket, "aberto");
  const selecao = new Despacho().selecionar(situacaoDeUmaDemanda(ag, predecessorasSatisfeitas));
  if (!selecao.prontos.includes(ticket)) {
    const [motivo, orientacao] = impedimento(ag, ticket, selecao);
    throw new ErroDeRegra(`o ticket ${formatarTicketRef(ticket)} não pode ser reservado: ${motivo}`, orientacao);
  }
  return mudarTicket(ag, ticket, "em_execucao", ctx.agora);
}

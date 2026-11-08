// Reserva do ticket da demanda SDLC (comparacao-sdlc-implementacao.md §4.1): aberto → em_execucao, só se a seleção o escolhe.
import { z } from "zod";
import { type Ator, exigirAtor } from "./ator.ts";
import type { AgregadoDemanda, TicketDemanda } from "./agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "./demanda.ts";
import { CICLO_DO_TICKET } from "./ciclos.ts";
import { ErroDeRegra } from "./erros.ts";
import { Endereco, estaOcupado, GrafoDeDependencias } from "./item_de_trabalho.ts";
import { Id } from "./primitivos.ts";
import { selecionarTrabalho } from "./selecao_trabalho.ts";
import { comTentativaAberta } from "./tentativa.ts";
import { type ContextoDemanda, exigirDemandaEmAndamento, mudarTicket, ticketDaDemanda } from "./transicoes_demanda.ts";

const EntradaReserva = z.strictObject({ ticket_id: Id });

/** Por que a seleção não escolheu o ticket, na ordem de `selecionarTrabalho`. */
function impedimento(ag: AgregadoDemanda, t: TicketDemanda, predecessorasSatisfeitas: boolean): [string, string] {
  const { id: demanda_id, estado } = ag.demanda;
  const ref = (ticket_id: number) => formatarTicketRef({ demanda_id, ticket_id });
  const concluido = (ticket_id: number) =>
    ag.tickets.some((x) => x.ticket_id === ticket_id && x.estado === "concluido");
  const ticketOcupado = (x: TicketDemanda) => estaOcupado(ag, Endereco.doTicket(demanda_id, x.ticket_id));
  if (estado === "planejar" && t.etapa === "planejar" && !predecessorasSatisfeitas) {
    return ["as predecessoras da demanda ainda não foram satisfeitas", "espere as predecessoras serem satisfeitas"];
  }
  const global = ag.tickets.find((x) => x.rodada_id === undefined && ticketOcupado(x));
  if (estado === "em_execucao" && global) {
    return [`o ticket ${ref(global.ticket_id)} da demanda está ${global.estado}`, "espere ele ser resolvido"];
  }
  const [dep] = GrafoDeDependencias.dosTickets(ag).pendentes(t.ticket_id, concluido);
  if (dep !== undefined) return [`depende do ticket ${ref(dep)}, ainda não concluído`, "espere a conclusão dele"];
  const [depRodada] =
    t.rodada_id === undefined
      ? []
      : GrafoDeDependencias.dasRodadas(ag).pendentes(t.rodada_id, (rodada_id) =>
          ag.rodadas.some((r) => r.rodada_id === rodada_id && r.estado === "concluida"),
        );
  if (depRodada !== undefined) {
    const rodada = formatarRodadaRef({ demanda_id, rodada_id: depRodada });
    return [`a rodada ${rodada} da qual a sua depende não foi concluída`, "espere a conclusão dela"];
  }
  const outro = ag.tickets.find((x) => x.rodada_id === t.rodada_id && ticketOcupado(x));
  if (outro) return [`o ticket ${ref(outro.ticket_id)} da rodada está ${outro.estado}`, "espere ele ser resolvido"];
  const escolhido = selecionarTrabalho(ag, predecessorasSatisfeitas).find(
    (x) => x.etapa === t.etapa && x.rodada_id === t.rodada_id,
  );
  if (escolhido) return [`o ticket ${ref(escolhido.ticket_id)} aberto vem antes`, "reserve o de menor id"];
  return [`a etapa ${t.etapa} não é a do trabalho do estado ${estado}`, "só o trabalho elegível do estado"];
}

/** CA-1 a CA-7: só a Fabriquinha reserva, e só o ticket aberto que `selecionarTrabalho` escolhe; vira `em_execucao`. */
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
  if (!selecionarTrabalho(ag, predecessorasSatisfeitas).includes(ticket)) {
    const [motivo, orientacao] = impedimento(ag, ticket, predecessorasSatisfeitas);
    throw new ErroDeRegra(`o ticket ${formatarTicketRef(ticket)} não pode ser reservado: ${motivo}`, orientacao);
  }
  return mudarTicket(ag, ticket, "em_execucao", ctx.agora);
}

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

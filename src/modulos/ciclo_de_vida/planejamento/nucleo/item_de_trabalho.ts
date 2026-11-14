// Peças comuns dos três Itens de Trabalho (Demanda, Rodada e Ticket; CONCEITOS.md §4 e §14): o endereço, o ticket
// atual da etapa, os próximos ids e a fábrica de ticket. O grafo de dependências sem ciclo é do shared.
// Recebem só as listas do agregado que leem (o agregado é do Processo, que depende de Planejamento).
import type { Ator, Endereco, EtapaTicket } from "../../etapas/publico.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";

/** O ticket como os Itens de Trabalho o leem. */
interface TicketDoItem {
  readonly ticket_id: number;
  readonly rodada_id?: number;
  readonly etapa: EtapaTicket;
  readonly estado: string;
}

/**
 * O ticket atual da etapa: o de maior `ticket_id`, na rodada `rodada` quando informada, entre os que `aceito` aceita
 * (todos, se omitido).
 */
export function ticketAtualDaEtapa<Ticket extends TicketDoItem>(
  ag: { readonly tickets: readonly Ticket[] },
  etapa: EtapaTicket,
  rodada?: number,
  aceito: (ticket: Ticket) => boolean = () => true,
): Ticket | undefined {
  return ag.tickets
    .filter((t) => t.etapa === etapa && (rodada === undefined || t.rodada_id === rodada) && aceito(t))
    .reduce<Ticket | undefined>((atual, t) => (atual && atual.ticket_id > t.ticket_id ? atual : t), undefined);
}

export const proximoIdDeTicket = (ag: { readonly tickets: readonly { readonly ticket_id: number }[] }): number =>
  ag.tickets.reduce((maior, t) => Math.max(maior, t.ticket_id), 0) + 1;

export const proximoIdDeRodada = (ag: { readonly rodadas: readonly { readonly rodada_id: number }[] }): number =>
  ag.rodadas.reduce((maior, r) => Math.max(maior, r.rodada_id), 0) + 1;

/** Um ticket `aberto` novo, com o próximo id; só os da rodada carregam `rodada_id`. */
export function criarTicket(
  ag: { readonly demanda: { readonly id: string }; readonly tickets: readonly { readonly ticket_id: number }[] },
  { etapa, rodada, criado_por, agora }: { etapa: EtapaTicket; rodada?: number; criado_por: Ator; agora: Instante },
) {
  return {
    demanda_id: ag.demanda.id,
    ticket_id: proximoIdDeTicket(ag),
    ...(rodada !== undefined && { rodada_id: rodada }),
    etapa,
    estado: "aberto" as const,
    estado_alterado_em: agora,
    criado_por,
  };
}

/**
 * Se o item tem ticket que falhou ou está em execução: o ticket, para o endereço dele; a rodada, pelos tickets dela;
 * a demanda, pelos tickets que não são de rodada.
 */
export function estaOcupado(ag: { readonly tickets: readonly TicketDoItem[] }, item: Endereco): boolean {
  return ag.tickets.some(
    (t) =>
      (t.estado === "falhou" || t.estado === "em_execucao") &&
      (item.ticket_id === undefined ? t.rodada_id === item.rodada_id : t.ticket_id === item.ticket_id),
  );
}

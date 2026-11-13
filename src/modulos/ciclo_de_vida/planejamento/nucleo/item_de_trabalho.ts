// Peças comuns dos três Itens de Trabalho (Demanda, Rodada e Ticket; CONCEITOS.md §4 e §14): o endereço, o grafo de
// dependências sem ciclo, o ticket atual da etapa, os próximos ids e a fábrica de ticket.
// Recebem só as listas do agregado que leem (o agregado é do Processo, que depende de Planejamento).
import type { Ator, Endereco, EtapaTicket } from "../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../../shared/nucleo/primitivos.ts";

/** O ticket como os Itens de Trabalho o leem. */
interface TicketDoItem {
  readonly ticket_id: number;
  readonly rodada_id?: number;
  readonly etapa: EtapaTicket;
  readonly estado: string;
}

/** Os nós de um ciclo em `grafo`, ou `undefined` se ele é acíclico (busca em profundidade com pilha). */
function acharCiclo(grafo: Map<string, string[]>): string[] | undefined {
  const feitos = new Set<string>();
  const visitar = (no: string, pilha: string[]): string[] | undefined => {
    const i = pilha.indexOf(no);
    if (i >= 0) return pilha.slice(i);
    if (feitos.has(no)) return undefined;
    for (const dep of grafo.get(no) ?? []) {
      const ciclo = visitar(dep, [...pilha, no]);
      if (ciclo) return ciclo;
    }
    feitos.add(no);
    return undefined;
  };
  for (const no of grafo.keys()) {
    const ciclo = visitar(no, []);
    if (ciclo) return ciclo;
  }
  return undefined;
}

/** O grafo de dependências de um tipo de Item de Trabalho: cada aresta é `[dependente, dependencia]`. */
export class GrafoDeDependencias<Chave extends string | number> {
  private readonly arestas: readonly (readonly [Chave, Chave])[];
  private readonly nomeDosItens: string;

  constructor(arestas: readonly (readonly [Chave, Chave])[], nomeDosItens = "os itens") {
    this.arestas = arestas;
    this.nomeDosItens = nomeDosItens;
  }

  /** As dependências entre as rodadas do agregado. */
  static dasRodadas(ag: {
    readonly dependencias_rodada: readonly { readonly rodada_id: number; readonly depende_rodada_id: number }[];
  }): GrafoDeDependencias<number> {
    return new GrafoDeDependencias(
      ag.dependencias_rodada.map((d) => [d.rodada_id, d.depende_rodada_id]),
      "as rodadas",
    );
  }

  /** As dependências entre os tickets do agregado. */
  static dosTickets(ag: {
    readonly dependencias_ticket: readonly { readonly ticket_id: number; readonly depende_ticket_id: number }[];
  }): GrafoDeDependencias<number> {
    return new GrafoDeDependencias(
      ag.dependencias_ticket.map((d) => [d.ticket_id, d.depende_ticket_id]),
      "os tickets",
    );
  }

  /** O ciclo do grafo escrito para o operador, ou `undefined` se ele não tem ciclo (autodependência é ciclo). */
  descreverCiclo(): string | undefined {
    const grafo = new Map<string, string[]>();
    for (const [dependente, dependencia] of this.arestas) {
      grafo.set(String(dependente), [...(grafo.get(String(dependente)) ?? []), String(dependencia)]);
    }
    const ciclo = acharCiclo(grafo);
    return ciclo && `${this.nomeDosItens} ${ciclo.join(" → ")} formam um ciclo de dependência`;
  }

  exigirSemCiclo(): void {
    const ciclo = this.descreverCiclo();
    if (ciclo) throw new ErroDeRegra(ciclo);
  }

  /** As dependências de `item` que `satisfeita` ainda recusa, na ordem das arestas. */
  pendentes(item: Chave, satisfeita: (dependencia: Chave) => boolean): Chave[] {
    return this.arestas
      .filter(([dependente, dependencia]) => dependente === item && !satisfeita(dependencia))
      .map(([, dependencia]) => dependencia);
  }
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

// Peças comuns dos três Itens de Trabalho (Demanda, Rodada e Ticket; CONCEITOS.md §4 e §14): o endereço, o grafo de
// dependências sem ciclo, o ticket atual da etapa, os próximos ids e a fábrica de ticket.
import type { AgregadoDemanda, TicketDemanda } from "./agregado_demanda.ts";
import type { Ator } from "./ator.ts";
import { ErroDeRegra } from "./erros.ts";
import type { EtapaTicket, Instante } from "./primitivos.ts";

const FORMAS_DO_ENDERECO =
  "use I-n para a demanda (ou só o número), I-n.Rm para a rodada ou I-n.Tm para o ticket, como I-206, I-206.R2 ou I-206.T3";
// Até 10 algarismos, como o `DemandaId`: nenhum número passa do inteiro seguro.
const ENDERECO = /^(?:(?:[iI]-?)?([1-9][0-9]{0,9})|I-([1-9][0-9]{0,9})\.([RT])([1-9][0-9]{0,9}))$/;

/** O endereço público de um Item de Trabalho: `I-n` (demanda), `I-n.Rm` (rodada) ou `I-n.Tm` (ticket). */
export class Endereco {
  readonly demanda_id: string;
  readonly rodada_id?: number;
  readonly ticket_id?: number;

  private constructor(demanda_id: string, rodada_id?: number, ticket_id?: number) {
    this.demanda_id = demanda_id;
    this.rodada_id = rodada_id;
    this.ticket_id = ticket_id;
  }

  static daDemanda(demanda_id: string): Endereco {
    return new Endereco(demanda_id);
  }

  static daRodada(demanda_id: string, rodada_id: number): Endereco {
    return new Endereco(demanda_id, rodada_id);
  }

  static doTicket(demanda_id: string, ticket_id: number): Endereco {
    return new Endereco(demanda_id, undefined, ticket_id);
  }

  /** Lê `I-12` (também `i-12`, `i12`, `I12` e `12`), `I-12.R2` ou `I-12.T3`; qualquer outra forma é recusada dizendo o formato esperado. */
  static ler(texto: string): Endereco {
    const achado = ENDERECO.exec(texto);
    if (!achado) throw new ErroDeRegra(`endereço ${JSON.stringify(texto)} inválido`, FORMAS_DO_ENDERECO);
    const [, numeroDaDemanda, numero, letra, sufixo] = achado;
    if (numeroDaDemanda !== undefined) return Endereco.daDemanda(`I-${numeroDaDemanda}`);
    const demanda_id = `I-${String(numero)}`;
    return letra === "R"
      ? Endereco.daRodada(demanda_id, Number(sufixo))
      : Endereco.doTicket(demanda_id, Number(sufixo));
  }

  toString(): string {
    if (this.ticket_id !== undefined) return `${this.demanda_id}.T${String(this.ticket_id)}`;
    if (this.rodada_id !== undefined) return `${this.demanda_id}.R${String(this.rodada_id)}`;
    return this.demanda_id;
  }
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
  static dasRodadas(ag: AgregadoDemanda): GrafoDeDependencias<number> {
    return new GrafoDeDependencias(
      ag.dependencias_rodada.map((d) => [d.rodada_id, d.depende_rodada_id]),
      "as rodadas",
    );
  }

  /** As dependências entre os tickets do agregado. */
  static dosTickets(ag: AgregadoDemanda): GrafoDeDependencias<number> {
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
export function ticketAtualDaEtapa(
  ag: AgregadoDemanda,
  etapa: EtapaTicket,
  rodada?: number,
  aceito: (ticket: TicketDemanda) => boolean = () => true,
): TicketDemanda | undefined {
  return ag.tickets
    .filter((t) => t.etapa === etapa && (rodada === undefined || t.rodada_id === rodada) && aceito(t))
    .reduce<TicketDemanda | undefined>((atual, t) => (atual && atual.ticket_id > t.ticket_id ? atual : t), undefined);
}

export const proximoIdDeTicket = (ag: AgregadoDemanda): number =>
  ag.tickets.reduce((maior, t) => Math.max(maior, t.ticket_id), 0) + 1;

export const proximoIdDeRodada = (ag: AgregadoDemanda): number =>
  ag.rodadas.reduce((maior, r) => Math.max(maior, r.rodada_id), 0) + 1;

/** Um ticket `aberto` novo, com o próximo id; só os da rodada carregam `rodada_id`. */
export function criarTicket(
  ag: AgregadoDemanda,
  { etapa, rodada, criado_por, agora }: { etapa: EtapaTicket; rodada?: number; criado_por: Ator; agora: Instante },
): TicketDemanda {
  return {
    demanda_id: ag.demanda.id,
    ticket_id: proximoIdDeTicket(ag),
    ...(rodada !== undefined && { rodada_id: rodada }),
    etapa,
    estado: "aberto",
    devolucoes: 0,
    estado_alterado_em: agora,
    criado_por,
  };
}

/**
 * Se o item tem ticket que falhou ou está em execução: o ticket, para o endereço dele; a rodada, pelos tickets dela;
 * a demanda, pelos tickets que não são de rodada.
 */
export function estaOcupado(ag: AgregadoDemanda, item: Endereco): boolean {
  return ag.tickets.some(
    (t) =>
      (t.estado === "falhou" || t.estado === "em_execucao") &&
      (item.ticket_id === undefined ? t.rodada_id === item.rodada_id : t.ticket_id === item.ticket_id),
  );
}

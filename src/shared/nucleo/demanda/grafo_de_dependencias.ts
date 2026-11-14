// O grafo de dependências sem ciclo, que as rodadas e os tickets (Ciclo de Vida) e os pedidos (Demandas) usam.
import { ErroDeRegra } from "../erros.ts";

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

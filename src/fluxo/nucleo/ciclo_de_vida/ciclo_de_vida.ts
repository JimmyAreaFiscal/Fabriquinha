// Ciclo de vida de um item com estado (Demanda, Rodada ou Ticket): estados, transições permitidas, terminais e
// o que conta como em andamento ou satisfazendo dependência. Uma abstração só, em vez de uma máquina por item.
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import type { Instante } from "../../../compartilhado/nucleo/primitivos.ts";

interface ItemComEstado<Estado extends string> {
  readonly estado: Estado;
  readonly estado_alterado_em: Instante;
}

interface DefinicaoDoCiclo<Estado extends string> {
  /** Para cada estado, os estados a que ele pode ir. */
  readonly transicoes: Readonly<Record<Estado, readonly Estado[]>>;
  readonly terminais: readonly Estado[];
  readonly satisfazemDependencia: readonly Estado[];
  readonly emAndamento: readonly Estado[];
}

export class CicloDeVida<Estado extends string> {
  readonly transicoes: Readonly<Record<Estado, readonly Estado[]>>;
  readonly #terminais: readonly Estado[];
  readonly #satisfazemDependencia: readonly Estado[];
  readonly #emAndamento: readonly Estado[];

  constructor(definicao: DefinicaoDoCiclo<Estado>) {
    this.transicoes = definicao.transicoes;
    this.#terminais = definicao.terminais;
    this.#satisfazemDependencia = definicao.satisfazemDependencia;
    this.#emAndamento = definicao.emAndamento;
  }

  /** Recusa o item fora dos estados permitidos, antes de qualquer efeito. */
  exigir(item: { readonly estado: Estado }, ...permitidos: Estado[]): void {
    if (permitidos.includes(item.estado)) return;
    throw new ErroDeRegra(
      `o estado atual é ${item.estado}`,
      `só ${permitidos.length === 1 ? "no estado" : "nos estados"} ${permitidos.join(", ")}`,
    );
  }

  /** O item no estado `para`, com `estado_alterado_em` = `agora`; recusa a transição que o ciclo não declara. */
  mudar<Item extends ItemComEstado<Estado>>(item: Item, para: Estado, agora: Instante): Item {
    const destinos = this.transicoes[item.estado];
    if (!destinos.includes(para)) {
      throw new ErroDeRegra(
        `não há transição de ${item.estado} para ${para}`,
        destinos.length === 0 ? `${item.estado} é terminal` : `de ${item.estado} só se vai a ${destinos.join(", ")}`,
      );
    }
    return { ...item, estado: para, estado_alterado_em: agora };
  }

  ehTerminal(estado: Estado): boolean {
    return this.#terminais.includes(estado);
  }

  satisfazDependencia(estado: Estado): boolean {
    return this.#satisfazemDependencia.includes(estado);
  }

  estaEmAndamento(estado: Estado): boolean {
    return this.#emAndamento.includes(estado);
  }

  /** O predicado SQL "a coluna está num estado terminal": a única fonte desse SQL. */
  sqlDosTerminais(coluna: string): string {
    return `${coluna} IN (${this.#terminais.map((estado) => `'${estado}'`).join(", ")})`;
  }
}

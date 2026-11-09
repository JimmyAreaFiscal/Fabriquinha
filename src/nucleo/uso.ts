// Uso de tokens e custo por Trabalho Agêntico: o consumo por modelo, agrupável e somável em qualquer nível.

/**
 * O Uso de um modelo (`provedor/modelo`): tokens, chamadas e o custo, `null` quando desconhecido (D10), nunca 0.
 */
export interface LinhaDeUso {
  modelo: string;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache_leitura: number;
  tokens_cache_escrita: number;
  custo: number | null;
  chamadas: number;
}

/** Soma dois custos: o desconhecido some diante do conhecido (o total vira piso, avisado por `trabalhosSemCusto`). */
function somarCustoDaLinha(a: number | null, b: number | null): number | null {
  return a === null || b === null ? (a ?? b) : a + b;
}

function somarLinha(a: LinhaDeUso, b: LinhaDeUso): LinhaDeUso {
  return {
    modelo: a.modelo,
    tokens_entrada: a.tokens_entrada + b.tokens_entrada,
    tokens_saida: a.tokens_saida + b.tokens_saida,
    tokens_cache_leitura: a.tokens_cache_leitura + b.tokens_cache_leitura,
    tokens_cache_escrita: a.tokens_cache_escrita + b.tokens_cache_escrita,
    custo: somarCustoDaLinha(a.custo, b.custo),
    chamadas: a.chamadas + b.chamadas,
  };
}

/**
 * O consumo de qualquer Trabalho Agêntico, agrupado por modelo, e quantos Trabalhos não trouxeram custo.
 */
export class Uso {
  readonly #linhas: ReadonlyMap<string, LinhaDeUso>;
  readonly #trabalhosSemCusto: number;

  private constructor(linhas: ReadonlyMap<string, LinhaDeUso>, trabalhosSemCusto: number) {
    this.#linhas = linhas;
    this.#trabalhosSemCusto = trabalhosSemCusto;
  }

  static vazio(): Uso {
    return new Uso(new Map(), 0);
  }

  /**
   * O Uso de `trabalhos` Trabalhos que produziram `linhas`: se alguma linha tem custo desconhecido, todos eles contam
   * como sem custo. Quem mede mais de um Trabalho com custos diferentes soma um `de` por Trabalho.
   * @throws RangeError se algum custo for negativo.
   */
  static de(linhas: readonly LinhaDeUso[], trabalhos: number): Uso {
    const porModelo = new Map<string, LinhaDeUso>();
    for (const linha of linhas) {
      if (linha.custo !== null && linha.custo < 0) throw new RangeError(`custo negativo para ${linha.modelo}`);
      const anterior = porModelo.get(linha.modelo);
      porModelo.set(linha.modelo, anterior ? somarLinha(anterior, linha) : linha);
    }
    return new Uso(porModelo, linhas.some((linha) => linha.custo === null) ? trabalhos : 0);
  }

  somar(outro: Uso): Uso {
    const porModelo = new Map(this.#linhas);
    for (const [modelo, linha] of outro.#linhas) {
      const anterior = porModelo.get(modelo);
      porModelo.set(modelo, anterior ? somarLinha(anterior, linha) : linha);
    }
    return new Uso(porModelo, this.#trabalhosSemCusto + outro.#trabalhosSemCusto);
  }

  /** As linhas em ordem de modelo. */
  porModelo(): LinhaDeUso[] {
    return [...this.#linhas.values()].toSorted((a, b) => a.modelo.localeCompare(b.modelo));
  }

  /** O custo conhecido (piso do total quando `trabalhosSemCusto > 0`) e quantos Trabalhos não trouxeram custo. */
  custo(): { conhecido: number; trabalhosSemCusto: number } {
    let conhecido = 0;
    for (const { custo } of this.#linhas.values()) conhecido += custo ?? 0;
    return { conhecido, trabalhosSemCusto: this.#trabalhosSemCusto };
  }
}

/**
 * O custo de `uso` como as telas o mostram: "US$ 4,20", ou "≥ US$ 4,20 (2 sessões sem custo)" quando falta custo.
 * @testes as telas passam a usá-la nos próximos tickets da rodada
 */
export function textoDoCusto(uso: Uso): string {
  const { conhecido, trabalhosSemCusto } = uso.custo();
  const dolares = `US$ ${conhecido.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (trabalhosSemCusto === 0) return dolares;
  return `≥ ${dolares} (${String(trabalhosSemCusto)} ${trabalhosSemCusto === 1 ? "sessão" : "sessões"} sem custo)`;
}

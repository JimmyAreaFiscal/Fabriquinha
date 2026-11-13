// Uso de tokens e custo por Trabalho Agêntico: o consumo por modelo, agrupável e somável em qualquer nível. Custo informado,
// estimado e desconhecido ficam distinguíveis (MELHORIAS §9, regra 5; §13, item 2).
import type { LinhaDeUso } from "../../harness/publico.ts";

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
    ...((a.custo_estimado ?? b.custo_estimado) && { custo_estimado: true }),
    chamadas: a.chamadas + b.chamadas,
  };
}

/** O custo de um Uso: o conhecido (informado ou estimado), e quantos Trabalhos ficaram sem custo e com custo estimado. */
export interface CustoDoUso {
  /** Piso do total quando `trabalhosSemCusto > 0`. */
  conhecido: number;
  trabalhosSemCusto: number;
  trabalhosComCustoEstimado: number;
}

/**
 * O consumo de qualquer Trabalho Agêntico, agrupado por modelo, e quantos Trabalhos não trouxeram custo ou o tiveram
 * estimado pelo catálogo de preços.
 */
export class Uso {
  readonly #linhas: ReadonlyMap<string, LinhaDeUso>;
  readonly #trabalhosSemCusto: number;
  readonly #trabalhosComCustoEstimado: number;

  private constructor(
    linhas: ReadonlyMap<string, LinhaDeUso>,
    trabalhosSemCusto: number,
    trabalhosComCustoEstimado: number,
  ) {
    this.#linhas = linhas;
    this.#trabalhosSemCusto = trabalhosSemCusto;
    this.#trabalhosComCustoEstimado = trabalhosComCustoEstimado;
  }

  static vazio(): Uso {
    return new Uso(new Map(), 0, 0);
  }

  /**
   * O Uso de `trabalhos` Trabalhos que produziram `linhas`: se alguma linha tem custo desconhecido, todos eles contam
   * como sem custo; se alguma tem custo estimado, todos contam como estimados. Quem mede mais de um Trabalho com custos
   * diferentes soma um `de` por Trabalho.
   * @throws RangeError se algum custo for negativo.
   */
  static de(linhas: readonly LinhaDeUso[], trabalhos: number): Uso {
    const porModelo = new Map<string, LinhaDeUso>();
    for (const linha of linhas) {
      if (linha.custo !== null && linha.custo < 0) throw new RangeError(`custo negativo para ${linha.modelo}`);
      const anterior = porModelo.get(linha.modelo);
      porModelo.set(linha.modelo, anterior ? somarLinha(anterior, linha) : linha);
    }
    return new Uso(
      porModelo,
      linhas.some((linha) => linha.custo === null) ? trabalhos : 0,
      linhas.some((linha) => linha.custo_estimado) ? trabalhos : 0,
    );
  }

  somar(outro: Uso): Uso {
    const porModelo = new Map(this.#linhas);
    for (const [modelo, linha] of outro.#linhas) {
      const anterior = porModelo.get(modelo);
      porModelo.set(modelo, anterior ? somarLinha(anterior, linha) : linha);
    }
    return new Uso(
      porModelo,
      this.#trabalhosSemCusto + outro.#trabalhosSemCusto,
      this.#trabalhosComCustoEstimado + outro.#trabalhosComCustoEstimado,
    );
  }

  /** As linhas em ordem de modelo. */
  porModelo(): LinhaDeUso[] {
    return [...this.#linhas.values()].toSorted((a, b) => a.modelo.localeCompare(b.modelo));
  }

  custo(): CustoDoUso {
    let conhecido = 0;
    for (const { custo } of this.#linhas.values()) conhecido += custo ?? 0;
    return {
      conhecido,
      trabalhosSemCusto: this.#trabalhosSemCusto,
      trabalhosComCustoEstimado: this.#trabalhosComCustoEstimado,
    };
  }
}

// Instanciar o formatador é caro; `toLocaleString` o recriaria a cada chamada.
const formatadorDeDolares = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sessoes = (quantas: number): string => `${String(quantas)} ${quantas === 1 ? "sessão" : "sessões"}`;

/**
 * O custo como as telas o mostram: "US$ 4,20"; "≥ US$ 4,20 (2 sessões sem custo)" quando falta custo; e
 * "US$ 4,20 (estimado em 1 sessão)" quando parte dele veio do catálogo de preços. Os avisos ficam entre parênteses,
 * separados por ";".
 */
export function textoDoCustoDe({ conhecido, trabalhosSemCusto, trabalhosComCustoEstimado }: CustoDoUso): string {
  const avisos = [
    ...(trabalhosSemCusto > 0 ? [`${sessoes(trabalhosSemCusto)} sem custo`] : []),
    ...(trabalhosComCustoEstimado > 0 ? [`estimado em ${sessoes(trabalhosComCustoEstimado)}`] : []),
  ];
  const dolares = `${trabalhosSemCusto > 0 ? "≥ " : ""}US$ ${formatadorDeDolares.format(conhecido)}`;
  return avisos.length === 0 ? dolares : `${dolares} (${avisos.join("; ")})`;
}

/** O custo de `uso` como as telas o mostram. */
export const textoDoCusto = (uso: Uso): string => textoDoCustoDe(uso.custo());

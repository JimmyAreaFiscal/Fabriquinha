// O cálculo de uma Métrica por recorte (CONCEITOS.md §16): cada classe deriva o valor do que os outros conceitos
// registram. A Métrica de Sucesso de uma Etapa sai por Etapa que a declara (`DefinicaoDaEtapa.metricas`); a do SDLC,
// um valor só para o recorte inteiro, sem Etapa. Cada Métrica tem a consulta própria (`lerFatos`), que lê só os fatos
// dela, e a fórmula (`formula`), pura, que deriva o valor dos fatos: pedir uma Métrica não calcula as demais.
import { CATALOGO_DE_ETAPAS, EtapaTicket, type TipoMetrica } from "../../etapas/publico.ts";
import type { DefinicaoDaMetrica, Recorte } from "../nucleo/metrica.ts";
import { type EscopoDosFatos, escopoDoRecorte, type OrigemDosFatos } from "./leitura_dos_fatos.ts";

/** O valor de uma Métrica, com a definição que a tela mostra. */
export interface ValorDaMetrica {
  definicao: DefinicaoDaMetrica<string>;
  valor: unknown;
}

/** A Métrica de Sucesso que cada Etapa que a declara mede à parte. */
export abstract class MetricaPorEtapa<Fatos, Valor> {
  abstract readonly definicao: DefinicaoDaMetrica;

  get tipo(): TipoMetrica {
    return this.definicao.tipo;
  }

  /** O valor em cada Etapa que declara a Métrica; sem registro no recorte, o valor é zero (ou `null` quando não há o que medir). */
  calcular(origem: OrigemDosFatos, recorte: Recorte): Map<EtapaTicket, Valor> {
    const valorDaEtapa = this.formula(this.lerFatos(escopoDoRecorte(origem, recorte)));
    return new Map(
      EtapaTicket.options
        .filter((etapa) => CATALOGO_DE_ETAPAS[etapa].metricas.includes(this.tipo))
        .map((etapa) => [etapa, valorDaEtapa(etapa)]),
    );
  }

  /** A consulta própria: lê dos donos, uma vez, só os fatos do recorte que a fórmula usa. */
  protected abstract lerFatos(escopo: EscopoDosFatos): Fatos;

  /** A fórmula, pura: como o valor de cada Etapa sai dos fatos. */
  abstract formula(fatos: Fatos): (etapa: EtapaTicket) => Valor;
}

/** A Métrica do SDLC inteiro: um valor para o recorte, de todas as Etapas juntas; nenhuma Etapa a declara. */
export abstract class MetricaDoSdlc<Tipo extends string, Fatos, Valor> {
  abstract readonly definicao: DefinicaoDaMetrica<Tipo>;

  /** O valor no recorte; sem registro nele, zero. */
  calcular(origem: OrigemDosFatos, recorte: Recorte): Valor {
    return this.formula(this.lerFatos(escopoDoRecorte(origem, recorte)));
  }

  /** A consulta própria: lê dos donos, uma vez, só os fatos do recorte que a fórmula usa. */
  protected abstract lerFatos(escopo: EscopoDosFatos): Fatos;

  /** A fórmula, pura: o valor que sai dos fatos. */
  abstract formula(fatos: Fatos): Valor;
}

/** O valor que um cálculo devolve: em cada Etapa que declara a Métrica, ou no SDLC inteiro. */
export type ValorDe<Calculo> =
  Calculo extends MetricaPorEtapa<unknown, infer Valor>
    ? Valor
    : Calculo extends MetricaDoSdlc<string, unknown, infer Valor>
      ? Valor
      : never;

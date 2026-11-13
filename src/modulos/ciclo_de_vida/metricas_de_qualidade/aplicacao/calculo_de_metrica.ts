// O cálculo de uma Métrica por recorte (CONCEITOS.md §16): cada classe deriva o valor do que os outros conceitos
// registram. A Métrica de Sucesso de uma Etapa sai por Etapa que a declara (`DefinicaoDaEtapa.metricas`); a do SDLC,
// um valor só para o recorte inteiro, sem Etapa. Cada Métrica tem a consulta própria (`lerFatos`), que lê só os fatos
// dela, e a fórmula (`formula`), pura, que deriva o valor dos fatos: pedir uma Métrica não calcula as demais. Os fatos
// são datados e têm a demanda deles: o recorte dividido em partes (meses, demandas) lê os fatos uma vez e aplica a
// fórmula aos de cada parte.
import { CATALOGO_DE_ETAPAS, EtapaTicket, type TipoMetrica } from "../../etapas/publico.ts";
import type { DefinicaoDaMetrica, Recorte } from "../nucleo/metrica.ts";
import { type EscopoDosFatos, escopoDoRecorte, type OrigemDosFatos } from "./leitura_dos_fatos.ts";

/** O valor de uma Métrica, com a definição que a tela mostra. */
export interface ValorDaMetrica {
  definicao: DefinicaoDaMetrica<string>;
  valor: unknown;
}

/** Um fato lido pela consulta de uma Métrica: a demanda e o instante dele dizem em que parte do recorte ele cai. */
export interface FatoDatado {
  demanda_id: string;
  em: string;
}

/** Os fatos de uma Métrica: listas de fatos datados, que a divisão do recorte reparte sem ler de novo. */
type FatosDatados<Fatos> = { readonly [Lista in keyof Fatos]: readonly FatoDatado[] };

/** A parte do recorte em que o fato cai: o mês do instante, a demanda... */
export type ParteDoFato = (fato: FatoDatado) => string;

/** A divisão do recorte por demanda. */
export const DEMANDA_DO_FATO: ParteDoFato = (fato) => fato.demanda_id;

/** O valor do recorte inteiro e o de cada parte dele, com os fatos lidos uma vez só. */
export interface ValoresPorParte<Valor> {
  doRecorte(): Valor;
  /** A parte sem fato vale o que a fórmula dá sem fatos. */
  daParte(parte: string): Valor;
}

/** Os fatos de cada parte, com as mesmas listas e na mesma ordem em que foram lidos. */
function repartirFatos<Fatos extends FatosDatados<Fatos>>(
  fatos: Fatos,
  parteDoFato: ParteDoFato,
): (parte: string) => Fatos {
  const listas = Object.keys(fatos);
  const semFatos = () => Object.fromEntries(listas.map((lista) => [lista, [] as FatoDatado[]]));
  const fatosPorParte = new Map<string, Record<string, FatoDatado[]>>();
  for (const [lista, fatosDaLista] of Object.entries<readonly FatoDatado[]>(fatos))
    for (const fato of fatosDaLista) {
      const parte = parteDoFato(fato);
      const fatosDaParte = fatosPorParte.get(parte) ?? semFatos();
      fatosDaParte[lista]?.push(fato);
      fatosPorParte.set(parte, fatosDaParte);
    }
  const vazios = semFatos();
  return (parte) => (fatosPorParte.get(parte) ?? vazios) as unknown as Fatos;
}

/** O que as Métricas de Etapa e as do SDLC têm em comum: ler os fatos uma vez e derivar o valor deles. */
abstract class CalculoDeMetrica<Fatos extends FatosDatados<Fatos>, Valor> {
  /** O valor no recorte; sem registro nele, zero (ou `null` quando não há o que medir). */
  calcular(origem: OrigemDosFatos, recorte: Recorte): Valor {
    return this.valorDosFatos(this.lerFatos(escopoDoRecorte(origem, recorte)));
  }

  /** O valor do escopo e o de cada parte dele, pela parte de cada fato. */
  calcularPorParte(escopo: EscopoDosFatos, parteDoFato: ParteDoFato): ValoresPorParte<Valor> {
    const fatos = this.lerFatos(escopo);
    // Só quem pede as partes paga a repartição.
    let fatosDaParte: ((parte: string) => Fatos) | undefined;
    return {
      doRecorte: () => this.valorDosFatos(fatos),
      daParte: (parte) => this.valorDosFatos((fatosDaParte ??= repartirFatos(fatos, parteDoFato))(parte)),
    };
  }

  /** A consulta própria: lê dos donos, uma vez, só os fatos do recorte que a fórmula usa. */
  protected abstract lerFatos(escopo: EscopoDosFatos): Fatos;

  protected abstract valorDosFatos(fatos: Fatos): Valor;
}

/** A Métrica de Sucesso que cada Etapa que a declara mede à parte. */
export abstract class MetricaPorEtapa<Fatos extends FatosDatados<Fatos>, Valor> extends CalculoDeMetrica<
  Fatos,
  Map<EtapaTicket, Valor>
> {
  abstract readonly definicao: DefinicaoDaMetrica;

  get tipo(): TipoMetrica {
    return this.definicao.tipo;
  }

  /** O valor em cada Etapa que declara a Métrica. */
  protected valorDosFatos(fatos: Fatos): Map<EtapaTicket, Valor> {
    const valorDaEtapa = this.formula(fatos);
    return new Map(
      EtapaTicket.options
        .filter((etapa) => CATALOGO_DE_ETAPAS[etapa].metricas.includes(this.tipo))
        .map((etapa) => [etapa, valorDaEtapa(etapa)]),
    );
  }

  /** A fórmula, pura: como o valor de cada Etapa sai dos fatos. */
  abstract formula(fatos: Fatos): (etapa: EtapaTicket) => Valor;
}

/** A Métrica do SDLC inteiro: um valor para o recorte, de todas as Etapas juntas; nenhuma Etapa a declara. */
export abstract class MetricaDoSdlc<
  Tipo extends string,
  Fatos extends FatosDatados<Fatos>,
  Valor,
> extends CalculoDeMetrica<Fatos, Valor> {
  abstract readonly definicao: DefinicaoDaMetrica<Tipo>;

  protected valorDosFatos(fatos: Fatos): Valor {
    return this.formula(fatos);
  }

  /** A fórmula, pura: o valor que sai dos fatos. */
  abstract formula(fatos: Fatos): Valor;
}

/** O valor que um cálculo devolve: em cada Etapa que declara a Métrica, ou no SDLC inteiro. */
export type ValorDe<Calculo extends { calcular(origem: OrigemDosFatos, recorte: Recorte): unknown }> =
  ReturnType<Calculo["calcular"]> extends Map<EtapaTicket, infer Valor> ? Valor : ReturnType<Calculo["calcular"]>;

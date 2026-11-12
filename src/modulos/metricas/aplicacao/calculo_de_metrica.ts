// O cálculo de uma Métrica por recorte (CONCEITOS.md §16): cada classe deriva o valor do que os outros conceitos
// registram. A Métrica de Sucesso de uma Etapa sai por Etapa que a declara (`DefinicaoDaEtapa.metricas`); a do SDLC,
// um valor só para o recorte inteiro, sem Etapa.
import type { DatabaseSync } from "node:sqlite";
import { demandaExiste } from "../armazenamento/metricas_demanda.ts";
import { ErroDeInexistente } from "../../compartilhado/nucleo/erros.ts";
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../../etapas/catalogo.ts";
import type { DefinicaoDaMetrica, Recorte } from "../nucleo/metrica.ts";
import type { TipoMetrica } from "../../etapas/definicao/tipos_declaraveis.ts";

/** O valor de uma Métrica, com a definição que a tela mostra. */
export interface ValorDaMetrica {
  definicao: DefinicaoDaMetrica<string>;
  valor: unknown;
}

/** O recorte de uma Demanda que não existe falha: zero seria um total que ninguém registrou. */
function exigirDemandaDoRecorte(banco: DatabaseSync, recorte: Recorte): void {
  if (recorte.demandaId !== undefined && !demandaExiste(banco, recorte.demandaId))
    throw new ErroDeInexistente(`a demanda ${recorte.demandaId} não existe`, "confira o id da demanda");
}

/** A Métrica de Sucesso que cada Etapa que a declara mede à parte. */
export abstract class MetricaPorEtapa<Valor> {
  abstract readonly definicao: DefinicaoDaMetrica;

  get tipo(): TipoMetrica {
    return this.definicao.tipo;
  }

  /** O valor em cada Etapa que declara a Métrica; sem registro no recorte, o valor é zero (ou `null` quando não há o que medir). */
  calcular(banco: DatabaseSync, recorte: Recorte): Map<EtapaTicket, Valor> {
    exigirDemandaDoRecorte(banco, recorte);
    const valorDaEtapa = this.medir(banco, recorte);
    return new Map(
      EtapaTicket.options
        .filter((etapa) => CATALOGO_DE_ETAPAS[etapa].metricas.includes(this.tipo))
        .map((etapa) => [etapa, valorDaEtapa(etapa)]),
    );
  }

  /** Lê o recorte uma vez e devolve como o valor sai de cada Etapa. */
  protected abstract medir(banco: DatabaseSync, recorte: Recorte): (etapa: EtapaTicket) => Valor;
}

/** A Métrica do SDLC inteiro: um valor para o recorte, de todas as Etapas juntas; nenhuma Etapa a declara. */
export abstract class MetricaDoSdlc<Tipo extends string, Valor> {
  abstract readonly definicao: DefinicaoDaMetrica<Tipo>;

  /** O valor no recorte; sem registro nele, zero. */
  calcular(banco: DatabaseSync, recorte: Recorte): Valor {
    exigirDemandaDoRecorte(banco, recorte);
    return this.medir(banco, recorte);
  }

  protected abstract medir(banco: DatabaseSync, recorte: Recorte): Valor;
}

/** O valor que um cálculo devolve: em cada Etapa que declara a Métrica, ou no SDLC inteiro. */
export type ValorDe<Calculo> =
  Calculo extends MetricaPorEtapa<infer Valor>
    ? Valor
    : Calculo extends MetricaDoSdlc<string, infer Valor>
      ? Valor
      : never;

// O cálculo de uma Métrica de Sucesso por recorte (CONCEITOS.md §16): cada classe deriva o valor do que os outros conceitos registram.
import type { DatabaseSync } from "node:sqlite";
import { demandaExiste } from "../../armazenamento/metricas_demanda.ts";
import { ErroDeInexistente } from "../../nucleo/erros.ts";
import { CATALOGO_DE_ETAPAS } from "../../nucleo/etapa.ts";
import type { DefinicaoDaMetrica, Recorte, TipoMetrica } from "../../nucleo/metrica.ts";
import { EtapaTicket } from "../../nucleo/primitivos.ts";

/** O valor de uma Métrica numa Etapa, com a definição que a tela mostra. */
export interface ValorDaMetrica {
  definicao: DefinicaoDaMetrica;
  valor: unknown;
}

export abstract class CalculoDeMetrica<Valor> {
  abstract readonly definicao: DefinicaoDaMetrica;

  get tipo(): TipoMetrica {
    return this.definicao.tipo;
  }

  /** O valor em cada Etapa que declara a Métrica; sem registro no recorte, o valor é zero (ou `null` quando não há o que medir). */
  calcular(banco: DatabaseSync, recorte: Recorte): Map<EtapaTicket, Valor> {
    if (recorte.demandaId !== undefined && !demandaExiste(banco, recorte.demandaId))
      throw new ErroDeInexistente(`a demanda ${recorte.demandaId} não existe`, "confira o id da demanda");
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

// As alterações que a revisão exigiu: Decisões de reprovação e Tentativas reprovadas dos tickets da Etapa.
import type { DatabaseSync } from "node:sqlite";
import { decisoesDoRecorte, etapasDasTentativasReprovadasDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../nucleo/primitivos.ts";
import { CalculoDeMetrica } from "./calculo_de_metrica.ts";

export class MetricaDeExigenciasDeAlteracao extends CalculoDeMetrica<{ reprovacoes: number }> {
  readonly definicao = {
    tipo: "exigencias_de_alteracao",
    rotulo: "Exigências de alteração",
    fonte: "Decisões de reprovação e Tentativas",
  } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const etapasDasReprovacoes = [
      ...decisoesDoRecorte(banco, recorte)
        .filter((d) => d.reprovada)
        .map((d) => d.etapa),
      ...etapasDasTentativasReprovadasDoRecorte(banco, recorte),
    ];
    return (etapa: EtapaTicket) => ({ reprovacoes: etapasDasReprovacoes.filter((e) => e === etapa).length });
  }
}

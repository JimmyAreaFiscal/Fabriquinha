// As alterações que a revisão exigiu: Decisões de reprovação dos Gates (menos o da demanda) e Tentativas reprovadas, na revisão da rodada ou da demanda.
import type { DatabaseSync } from "node:sqlite";
import { decisoesDoRecorte, rodadasDasTentativasReprovadasDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import { CalculoDeMetrica } from "./calculo_de_metrica.ts";

/** A revisão que conta a Decisão reprovada de cada Gate, pela Etapa do ticket em que ele decide; o Gate da demanda fica em `aprovacoes_e_reprovacoes`. */
const REVISAO_DO_GATE: Record<string, EtapaTicket | undefined> = {
  revisar_rodada: "revisar_rodada",
  encerrar_rodada: "revisar_rodada",
  planejar: "revisar_demanda",
  revisar_demanda: "revisar_demanda",
};

export class MetricaDeExigenciasDeAlteracao extends CalculoDeMetrica<{ reprovacoes: number }> {
  readonly definicao = {
    tipo: "exigencias_de_alteracao",
    rotulo: "Exigências de alteração",
    fonte: "Decisões de reprovação e Tentativas",
  } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const revisoesDasDecisoes = decisoesDoRecorte(banco, recorte)
      .filter((d) => d.reprovada)
      .map((d) => REVISAO_DO_GATE[d.etapa]);
    const revisoesDasTentativas = rodadasDasTentativasReprovadasDoRecorte(banco, recorte).map((rodadaId) =>
      rodadaId === null ? "revisar_demanda" : "revisar_rodada",
    );
    const revisoes = [...revisoesDasDecisoes, ...revisoesDasTentativas];
    return (etapa: EtapaTicket) => ({ reprovacoes: revisoes.filter((revisao) => revisao === etapa).length });
  }
}

// As alterações que a revisão exigiu: Decisões de reprovação dos Gates (menos o da demanda) e Tentativas reprovadas, na revisão da rodada ou da demanda.
import type { DatabaseSync } from "node:sqlite";
import { decisoesDoRecorte, rodadasDasTentativasReprovadasDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../../../etapas/catalogo.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";

/** A revisão de cada escopo: a Etapa daquele escopo que mede as exigências de alteração. */
const REVISAO_DO_ESCOPO = new Map(
  EtapaTicket.options
    .filter((etapa) => CATALOGO_DE_ETAPAS[etapa].metricas.includes("exigencias_de_alteracao"))
    .map((etapa) => [CATALOGO_DE_ETAPAS[etapa].escopo, etapa]),
);

/**
 * A revisão que conta a Decisão reprovada do Gate de `etapa`: a do escopo dela. O Gate da Etapa que mede
 * `aprovacoes_e_reprovacoes` (o da demanda) conta lá, e a Decisão no ticket de Etapa sem Gate não conta.
 */
function revisaoDaDecisao(etapa: EtapaTicket): EtapaTicket | undefined {
  const { escopo, metricas, gate } = CATALOGO_DE_ETAPAS[etapa];
  if (gate === undefined || metricas.includes("aprovacoes_e_reprovacoes")) return undefined;
  return REVISAO_DO_ESCOPO.get(escopo);
}

export class MetricaDeExigenciasDeAlteracao extends MetricaPorEtapa<{ reprovacoes: number }> {
  readonly definicao = {
    tipo: "exigencias_de_alteracao",
    rotulo: "Exigências de alteração",
    fonte: "Decisões de reprovação e Tentativas",
  } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const revisoesDasDecisoes = decisoesDoRecorte(banco, recorte)
      .filter((d) => d.reprovada)
      .map((d) => revisaoDaDecisao(d.etapa as EtapaTicket));
    const revisoesDasTentativas = rodadasDasTentativasReprovadasDoRecorte(banco, recorte).map((rodadaId) =>
      REVISAO_DO_ESCOPO.get(rodadaId === null ? "demanda" : "rodada"),
    );
    const revisoes = [...revisoesDasDecisoes, ...revisoesDasTentativas];
    return (etapa: EtapaTicket) => ({ reprovacoes: revisoes.filter((revisao) => revisao === etapa).length });
  }
}

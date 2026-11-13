// As alterações que a revisão exigiu: Decisões de reprovação dos Gates (menos o da demanda) e Tentativas reprovadas, na revisão da rodada ou da demanda.
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../../../etapas/publico.ts";
import { tentativasReprovadasEmLote } from "../../../processo/publico.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, lerDecisoesDoRecorte, ticketsCitados } from "../leitura_dos_fatos.ts";

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

/** As Etapas dos tickets das Decisões reprovadas e as rodadas dos tickets das Tentativas reprovadas do recorte. */
interface FatosDasExigencias {
  etapasDasDecisoesReprovadas: string[];
  /** `null` fora de rodada: as vezes em que o agente teve de corrigir a entrega. */
  rodadasDasTentativasReprovadas: (number | null)[];
}

export class MetricaDeExigenciasDeAlteracao extends MetricaPorEtapa<FatosDasExigencias, { reprovacoes: number }> {
  readonly definicao = {
    tipo: "exigencias_de_alteracao",
    rotulo: "Exigências de alteração",
    fonte: "Decisões de reprovação e Tentativas",
  } as const;

  protected lerFatos(escopo: EscopoDosFatos): FatosDasExigencias {
    const reprovadas = tentativasReprovadasEmLote(escopo.banco, { demandas: escopo.demandas, periodo: escopo.periodo });
    const ticketDe = ticketsCitados(escopo.banco, reprovadas);
    return {
      etapasDasDecisoesReprovadas: lerDecisoesDoRecorte(escopo)
        .filter((decisao) => decisao.reprovada)
        .map((decisao) => decisao.etapa),
      rodadasDasTentativasReprovadas: reprovadas.map(
        ({ demanda_id, ticket_id }) => ticketDe(demanda_id, ticket_id).rodada_id,
      ),
    };
  }

  formula({ etapasDasDecisoesReprovadas, rodadasDasTentativasReprovadas }: FatosDasExigencias) {
    const revisoes = [
      ...etapasDasDecisoesReprovadas.map((etapa) => revisaoDaDecisao(etapa as EtapaTicket)),
      ...rodadasDasTentativasReprovadas.map((rodadaId) =>
        REVISAO_DO_ESCOPO.get(rodadaId === null ? "demanda" : "rodada"),
      ),
    ];
    return (etapa: EtapaTicket) => ({ reprovacoes: revisoes.filter((revisao) => revisao === etapa).length });
  }
}

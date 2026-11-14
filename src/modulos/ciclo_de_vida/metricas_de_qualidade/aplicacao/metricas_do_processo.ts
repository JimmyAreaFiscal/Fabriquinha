// As métricas do processo (decisão 6 da migração das interfaces): as de Sucesso que o Ciclo de Vida mede
// (`aprovacoes_e_reprovacoes`, `conformidade_com_o_plano`, `exigencias_de_alteracao`, `nota_humana`) e as do SDLC inteiro,
// no recorte e em cada parte dele. Traz também o que quem junta as métricas de Sessões e do Repositório precisa do Ciclo
// de Vida: a Etapa e a rodada do ticket de cada fato e o instante do registro de cada demanda.
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import type { EtapaTicket } from "../../etapas/publico.ts";
import { type PedidoDasMetricas, type Recorte, registroDoPedido } from "../nucleo/metrica.ts";
import type { ParteDoFato, ValorDaMetrica, ValoresPorParte } from "./calculo_de_metrica.ts";
import {
  escopoDoRecorte,
  type OrigemDosFatos,
  primeiraEvidenciaDoEscopo,
  ticketsCitados,
} from "./leitura_dos_fatos.ts";
import { metricasDasEtapasPorParte, metricasDoSdlcPorParte } from "./registro_das_metricas.ts";

export interface MetricasDoProcesso {
  /** Os pedidos das demandas que o recorte alcança, e os ids deles. */
  pedidos: readonly PedidoDasMetricas[];
  demandas: readonly string[];
  periodo: Pick<Recorte, "inicio" | "fim">;
  /** A Etapa e a rodada (`null` em ticket de demanda) do ticket citado por um fato. */
  ticketDoFato(demandaId: string, ticketId: number): { etapa: string; rodadaId: number | null };
  /** O instante do registro da demanda: o do Uso declarado, que não tem data própria. */
  registroDaDemanda(demandaId: string): string;
  /** As métricas do processo de cada Etapa que as declara, no recorte e em cada parte dele. */
  porEtapa(parteDoFato: ParteDoFato): ValoresPorParte<Map<EtapaTicket, ValorDaMetrica[]>>;
  /** As métricas do SDLC inteiro, no recorte e em cada parte dele. */
  doSdlc(parteDoFato: ParteDoFato): ValoresPorParte<ValorDaMetrica[]>;
}

/** O recorte de uma Demanda que não existe falha aqui, antes de qualquer leitura. Cada fonte é lida só se pedida. */
export function metricasDoCicloDeVida(origem: OrigemDosFatos, recorte: Recorte): MetricasDoProcesso {
  const escopo = escopoDoRecorte(origem, recorte);
  const pedidoPorId = new Map(escopo.pedidos.map((pedido) => [pedido.id, pedido]));
  return {
    pedidos: escopo.pedidos,
    demandas: escopo.demandas,
    periodo: escopo.periodo,
    ticketDoFato: (demandaId, ticketId) => {
      const ticket = ticketsCitados(escopo)(demandaId, ticketId);
      return { etapa: ticket.etapa, rodadaId: ticket.rodada_id };
    },
    registroDaDemanda: (demandaId) =>
      registroDoPedido(
        encontrado(
          pedidoPorId.get(demandaId),
          `a demanda ${demandaId} não está entre os pedidos`,
          "passe os pedidos de todas as demandas do recorte",
        ),
        primeiraEvidenciaDoEscopo(escopo).get(demandaId),
      ),
    porEtapa: (parteDoFato) => metricasDasEtapasPorParte(escopo, parteDoFato),
    doSdlc: (parteDoFato) => metricasDoSdlcPorParte(escopo, parteDoFato),
  };
}

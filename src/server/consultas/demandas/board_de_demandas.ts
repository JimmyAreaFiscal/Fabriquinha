// A consulta do board das demandas: as demandas fora das arquivadas e o trabalho global ativo, montados no contrato da
// API (contrato/) a partir de um snapshot só, com as leituras em lote, sem uma consulta por demanda.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../../modulos/sdlc/nucleo/demanda/agregado_demanda.ts";
import { CICLO_DA_DEMANDA } from "../../../modulos/sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import { encontrado } from "../../../modulos/compartilhado/nucleo/erros.ts";
import type { Relogio } from "../../../modulos/compartilhado/nucleo/relogio.ts";
import { listarDemandas } from "../../../modulos/sdlc/armazenamento/demandas.ts";
import { predecessorasDasDemandas } from "../../../modulos/sdlc/armazenamento/dependencias_demanda.ts";
import { lerEmSnapshot } from "../../../modulos/compartilhado/armazenamento/snapshot.ts";
import { ticketsComPiAtivo } from "../../../modulos/trabalho_agentico/armazenamento/trabalho_agentico.ts";
import type { BoardDeDemandas } from "../../contrato/demanda.ts";
import { bloqueiosDaDemanda } from "./bloqueios.ts";
import { enderecosNaDemanda, prDoGateDaRodada } from "./demanda.ts";
import { pendenciasDeUmaDemanda, situacaoDoCondutor, type SituacaoDaSessao } from "./pendencias.ts";

/** Os tickets `em_execucao` da demanda, com a rodada quando têm e `pi_ativo` quando é o pi que roda. */
const emExecucao = (ag: AgregadoDemanda, comPiAtivo: ReadonlySet<string>): BoardDeDemandas["trabalho"] =>
  ag.tickets
    .filter((t) => t.estado === "em_execucao")
    .map((t) => {
      const ticketRef = enderecosNaDemanda(ag.demanda.id).ticket(t.ticket_id);
      return {
        ref: ticketRef,
        etapa: t.etapa,
        ...(t.rodada_id !== undefined && { rodada: enderecosNaDemanda(ag.demanda.id).rodada(t.rodada_id) }),
        ...(comPiAtivo.has(ticketRef) && { pi_ativo: true as const }),
      };
    });

/** O board: as demandas fora das arquivadas e, no total, o trabalho global ativo. */
export function consultarBoardDeDemandas(
  banco: DatabaseSync,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacaoDoCondutor,
): BoardDeDemandas {
  return lerEmSnapshot(banco, () => {
    const todas = listarDemandas(banco);
    const comPiAtivo = ticketsComPiAtivo(banco);
    const predecessoras = predecessorasDasDemandas(
      banco,
      todas.map((ag) => ag.demanda.id),
    );
    const agora = relogio.agora();
    return {
      demandas: todas.map((ag) => {
        const { id, projeto, titulo, estado } = ag.demanda;
        return {
          id,
          projeto,
          titulo,
          estado,
          terminal: CICLO_DA_DEMANDA.ehTerminal(estado),
          rodadas: ag.rodadas.map((r) => {
            const pr = prDoGateDaRodada(ag, r.rodada_id);
            return { ref: enderecosNaDemanda(id).rodada(r.rodada_id), estado: r.estado, ...(pr && { pr }) };
          }),
          bloqueios: bloqueiosDaDemanda(
            encontrado(predecessoras.get(id), `a demanda ${id} não foi lida`, "recarregue"),
          ),
          pendencias: pendenciasDeUmaDemanda(banco, ag, situacaoDa, agora),
        };
      }),
      trabalho: todas.flatMap((ag) => emExecucao(ag, comPiAtivo)),
    };
  });
}

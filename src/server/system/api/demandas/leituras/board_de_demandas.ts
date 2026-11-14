// A consulta do board das demandas: as demandas fora das arquivadas e o trabalho global ativo, montados no contrato da
// API (contrato/) a partir de um snapshot só, com as leituras em lote, sem uma consulta por demanda.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeDemandas } from "../../../../../modulos/demandas/publico.ts";
import type { Relogio } from "../../../../../shared/nucleo/relogio.ts";
import { lerEmSnapshot } from "../../../../../shared/armazenamento/snapshot.ts";
import type { CicloDeVida, ResumoDaDemanda } from "../../../../../modulos/ciclo_de_vida/publico.ts";
import type { BoardDeDemandas } from "../../contrato/demanda.ts";
import { sessoesDasDemandas, ticketsComPiAtivo } from "../../sessoes/historico_demanda.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "./predecessoras.ts";
import { enderecosNaDemanda, prDoGateDaRodada } from "./demanda.ts";
import { pendenciasDasDemandas, situacoesDoBanco, type SituacaoDaSessao } from "./pendencias.ts";

/** Os tickets `em_execucao` da demanda, com a rodada quando têm e `pi_ativo` quando é o pi que roda. */
const emExecucao = (ag: ResumoDaDemanda, comPiAtivo: ReadonlySet<string>): BoardDeDemandas["trabalho"] =>
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
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacoesDoBanco(banco),
): BoardDeDemandas {
  return lerEmSnapshot(banco, () => {
    const todas = cicloDeVida.andamentos();
    const comPiAtivo = ticketsComPiAtivo(banco);
    const { demanda: cicloDaDemanda } = cicloDeVida.etapas();
    const predecessoras = predecessorasDasDemandas(
      cicloDeVida,
      gestaoDeDemandas,
      todas.map((ag) => ag.demanda.id),
    );
    // As Pendências de todas as demandas em andamento numa leitura só; a terminada não espera ninguém.
    const emAndamento = todas.filter((ag) => !cicloDaDemanda.ehTerminal(ag.demanda.estado));
    const pendencias = pendenciasDasDemandas(
      cicloDeVida,
      gestaoDeDemandas,
      emAndamento,
      sessoesDasDemandas(banco, cicloDeVida, emAndamento, { escopo: "ativas" }),
      situacaoDa,
      relogio.agora(),
    );
    return {
      demandas: todas.map((ag) => {
        const { id, projeto, titulo, estado } = ag.demanda;
        return {
          id,
          projeto,
          titulo,
          estado,
          terminal: cicloDaDemanda.ehTerminal(estado),
          rodadas: ag.rodadas.map((r) => {
            const pr = prDoGateDaRodada(cicloDeVida, ag, r.rodada_id);
            return { ref: enderecosNaDemanda(id).rodada(r.rodada_id), estado: r.estado, ...(pr && { pr }) };
          }),
          bloqueios: bloqueiosDaDemanda(cicloDeVida.etapas(), predecessorasDe(predecessoras, id)),
          pendencias: pendencias.filter((p) => p.demanda === id),
        };
      }),
      trabalho: todas.flatMap((ag) => emExecucao(ag, comPiAtivo)),
    };
  });
}

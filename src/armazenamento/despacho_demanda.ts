// Leituras do agendador das demandas (comparacao-sdlc-implementacao.md §4.1): o que há para despachar e quanto do
// limite global de paralelismo já está ocupado. Só lê; a reserva e o início são do serviço de despacho.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import type { EstadoDemanda } from "../nucleo/primitivos.ts";
import { carregarDemanda } from "./demandas.ts";
import { predecessorasDaDemanda } from "./dependencias_demanda.ts";
import { lerEmSnapshot } from "./snapshot.ts";

// `estados` são os da demanda em andamento em que o agendador despacha; quem os escolhe é a aplicação.
const emLista = (estados: readonly EstadoDemanda[]) => `(${estados.map((estado) => `'${estado}'`).join(", ")})`;

interface DemandaParaDespacho {
  agregado: AgregadoDemanda;
  predecessoras: { demanda_id: string; estado: EstadoDemanda }[];
}

/** As demandas em um dos `estados`, com o agregado e as predecessoras diretas. */
export const demandasParaDespacho = (banco: DatabaseSync, estados: readonly EstadoDemanda[]): DemandaParaDespacho[] =>
  lerEmSnapshot(banco, () =>
    banco
      .prepare(`SELECT id FROM demanda WHERE estado IN ${emLista(estados)} ORDER BY rowid`)
      .all()
      .map(({ id }) => ({
        agregado: carregarDemanda(banco, id as string),
        predecessoras: predecessorasDaDemanda(banco, id as string),
      })),
  );

// O `planejar` reprovado: em execução, com a última decisão `reprovado`. Ele aguarda a retomada e não ocupa vaga.
const PLANEJAR_REPROVADO = `t.etapa = 'planejar' AND (
  SELECT d.resultado FROM decisao_ticket d WHERE d.demanda_id = t.demanda_id AND d.ticket_id = t.ticket_id
  ORDER BY d.decisao_id DESC LIMIT 1) IS 'reprovado'`;

const EXECUCAO_DO_TICKET = `FROM trabalho_agentico s JOIN processo_do_trabalho e ON e.trabalho_id = s.id
  WHERE s.demanda_id = t.demanda_id AND s.ticket_id = t.ticket_id`;

/**
 * Ids das demandas em planejamento cujo `planejar` reprovado, sem execução aberta, não teve Tentativa nova desde a última
 * recusa: a retomada abre a Tentativa seguinte, e é ela que tira a demanda daqui.
 */
export const retomadasDePlanejamento = (banco: DatabaseSync): string[] =>
  banco
    .prepare(
      `SELECT t.demanda_id FROM ticket_demanda t JOIN demanda dm ON dm.id = t.demanda_id
       WHERE dm.estado = 'planejar' AND t.estado = 'em_execucao' AND ${PLANEJAR_REPROVADO}
         AND NOT EXISTS (SELECT 1 ${EXECUCAO_DO_TICKET} AND e.fim IS NULL)
         AND NOT EXISTS (SELECT 1 FROM tentativa x WHERE x.demanda_id = t.demanda_id AND x.ticket_id = t.ticket_id
           AND x.inicio >= (
             SELECT d.em FROM decisao_ticket d WHERE d.demanda_id = t.demanda_id AND d.ticket_id = t.ticket_id
             ORDER BY d.decisao_id DESC LIMIT 1))
       ORDER BY dm.rowid`,
    )
    .all()
    .map((l) => l.demanda_id as string);

/** Tickets `em_execucao` das demandas em um dos `estados` que ocupam vaga: gate humano e `planejar` reprovado sem execução aberta não. */
export const ocupacaoDoLimite = (banco: DatabaseSync, estados: readonly EstadoDemanda[]): number =>
  Number(
    banco
      .prepare(
        `SELECT COUNT(*) AS n FROM ticket_demanda t JOIN demanda dm ON dm.id = t.demanda_id
         WHERE dm.estado IN ${emLista(estados)} AND t.estado = 'em_execucao' AND t.etapa <> 'ajustar_resultado'
           AND NOT (t.etapa = 'encerrar_rodada' AND EXISTS (
             SELECT 1 FROM rodada r WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id
               AND r.estado = 'gate_pr'))
           AND NOT (${PLANEJAR_REPROVADO} AND NOT EXISTS (SELECT 1 ${EXECUCAO_DO_TICKET} AND e.fim IS NULL))`,
      )
      .get()?.n,
  );

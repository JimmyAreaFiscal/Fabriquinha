// Leituras do agendador das demandas (comparacao-sdlc-implementacao.md §4.1): o que há para despachar e quanto do
// limite global de paralelismo já está ocupado. Só lê; a reserva e o início são do serviço de despacho.
import type { DatabaseSync } from "node:sqlite";
import { predecessorasPendentes } from "../dominio/dependencia_demanda.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { carregarDemanda } from "./demandas.ts";
import { predecessorasDaDemanda } from "./dependencias_demanda.ts";

const FASES_LIDAS = "('planejamento', 'execucao', 'revisao_demanda', 'encerramento')";

export interface DemandaParaDespacho {
  agregado: AgregadoDemanda;
  predecessoras_satisfeitas: boolean;
}

/** Roda `ler` num snapshot só; dentro de `escrever` a leitura já é parte da transação. */
function noSnapshot<T>(banco: DatabaseSync, ler: () => T): T {
  const propria = !banco.isTransaction;
  if (propria) banco.exec("BEGIN");
  try {
    return ler();
  } finally {
    if (propria) banco.exec("COMMIT");
  }
}

/** Demandas em planejamento, execução, revisão da demanda e encerramento, com o agregado e se as predecessoras já satisfazem. */
export const demandasParaDespacho = (banco: DatabaseSync): DemandaParaDespacho[] =>
  noSnapshot(banco, () =>
    banco
      .prepare(`SELECT id FROM demanda WHERE fase IN ${FASES_LIDAS} ORDER BY rowid`)
      .all()
      .map(({ id }) => ({
        agregado: carregarDemanda(banco, id as string),
        predecessoras_satisfeitas: predecessorasPendentes(predecessorasDaDemanda(banco, id as string)).length === 0,
      })),
  );

// O `planejar` reprovado: em execução, com a última decisão `recusado`. Ele aguarda a retomada e não ocupa vaga.
const PLANEJAR_REPROVADO = `t.etapa = 'planejar' AND (
  SELECT d.resultado FROM decisao_ticket d WHERE d.demanda_id = t.demanda_id AND d.ticket_id = t.ticket_id
  ORDER BY d.decisao_id DESC LIMIT 1) IS 'recusado'`;

const EXECUCAO_DO_TICKET = `FROM sessao s JOIN execucao_sessao e ON e.sessao_id = s.id
  WHERE s.demanda_id = t.demanda_id AND s.ticket_id = t.ticket_id`;

/** Ids das demandas em planejamento cujo `planejar` reprovado, sem execução aberta, não foi retomado desde a última recusa. */
export const retomadasDePlanejamento = (banco: DatabaseSync): string[] =>
  banco
    .prepare(
      `SELECT t.demanda_id FROM ticket_demanda t JOIN demanda dm ON dm.id = t.demanda_id
       WHERE dm.fase = 'planejamento' AND t.status = 'em_execucao' AND ${PLANEJAR_REPROVADO}
         AND NOT EXISTS (SELECT 1 ${EXECUCAO_DO_TICKET} AND e.fim IS NULL)
         AND NOT EXISTS (SELECT 1 ${EXECUCAO_DO_TICKET} AND e.inicio >= (
           SELECT d.em FROM decisao_ticket d WHERE d.demanda_id = t.demanda_id AND d.ticket_id = t.ticket_id
           ORDER BY d.decisao_id DESC LIMIT 1))
       ORDER BY dm.rowid`,
    )
    .all()
    .map((l) => l.demanda_id as string);

/** Tickets de demanda `em_execucao` que ocupam vaga: gate humano e `planejar` reprovado sem execução aberta não. */
export const ocupacaoDoLimite = (banco: DatabaseSync): number =>
  Number(
    banco
      .prepare(
        `SELECT COUNT(*) AS n FROM ticket_demanda t JOIN demanda dm ON dm.id = t.demanda_id
         WHERE dm.fase IN ${FASES_LIDAS} AND t.status = 'em_execucao' AND t.etapa <> 'sessao_em_aberto'
           AND NOT (t.etapa = 'encerrar_rodada' AND EXISTS (
             SELECT 1 FROM rodada r WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id
               AND r.fase = 'aprovacao_pull_request'))
           AND NOT (${PLANEJAR_REPROVADO} AND NOT EXISTS (SELECT 1 ${EXECUCAO_DO_TICKET} AND e.fim IS NULL))`,
      )
      .get()?.n,
  );

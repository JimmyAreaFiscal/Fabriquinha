// Leituras do agendador das demandas (comparacao-sdlc-implementacao.md §4.1): o que há para despachar e quanto do
// limite global de paralelismo já está ocupado. Só lê; a reserva e o início são do serviço de despacho.
import type { DatabaseSync } from "node:sqlite";
import { predecessorasPendentes } from "../nucleo/dependencia_demanda.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { CICLO_DA_DEMANDA, etapaDoEstado } from "../nucleo/ciclos.ts";
import { EstadoDemanda } from "../nucleo/primitivos.ts";
import { carregarDemanda } from "./demandas.ts";
import { predecessorasDaDemanda } from "./dependencias_demanda.ts";

// Os estados em andamento em que o agendador despacha: fora da conversa do Auditor (`entender_e_desenhar`) e dos Gates,
// cuja Etapa é a do ticket que eles esperam, não a do estado.
const ESTADOS_LIDOS = `(${EstadoDemanda.options
  .filter(
    (estado) =>
      CICLO_DA_DEMANDA.estaEmAndamento(estado) &&
      estado !== "entender_e_desenhar" &&
      (etapaDoEstado(estado) ?? estado) === estado,
  )
  .map((estado) => `'${estado}'`)
  .join(", ")})`;

interface DemandaParaDespacho {
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
      .prepare(`SELECT id FROM demanda WHERE estado IN ${ESTADOS_LIDOS} ORDER BY rowid`)
      .all()
      .map(({ id }) => ({
        agregado: carregarDemanda(banco, id as string),
        predecessoras_satisfeitas: predecessorasPendentes(predecessorasDaDemanda(banco, id as string)).length === 0,
      })),
  );

// O `planejar` reprovado: em execução, com a última decisão `reprovado`. Ele aguarda a retomada e não ocupa vaga.
const PLANEJAR_REPROVADO = `t.etapa = 'planejar' AND (
  SELECT d.resultado FROM decisao_ticket d WHERE d.demanda_id = t.demanda_id AND d.ticket_id = t.ticket_id
  ORDER BY d.decisao_id DESC LIMIT 1) IS 'reprovado'`;

const EXECUCAO_DO_TICKET = `FROM sessao s JOIN execucao_sessao e ON e.sessao_id = s.id
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

/** Tickets de demanda `em_execucao` que ocupam vaga: gate humano e `planejar` reprovado sem execução aberta não. */
export const ocupacaoDoLimite = (banco: DatabaseSync): number =>
  Number(
    banco
      .prepare(
        `SELECT COUNT(*) AS n FROM ticket_demanda t JOIN demanda dm ON dm.id = t.demanda_id
         WHERE dm.estado IN ${ESTADOS_LIDOS} AND t.estado = 'em_execucao' AND t.etapa <> 'ajustar_resultado'
           AND NOT (t.etapa = 'encerrar_rodada' AND EXISTS (
             SELECT 1 FROM rodada r WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id
               AND r.estado = 'gate_pr'))
           AND NOT (${PLANEJAR_REPROVADO} AND NOT EXISTS (SELECT 1 ${EXECUCAO_DO_TICKET} AND e.fim IS NULL))`,
      )
      .get()?.n,
  );

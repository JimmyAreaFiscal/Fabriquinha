// Leituras do agendador das demandas (comparacao-sdlc-implementacao.md §4.1): o que há para despachar e quais tickets têm
// trabalho vivo. Só lê; a seleção é do Despacho, e a reserva e o início são do serviço de despacho.
import type { DatabaseSync } from "node:sqlite";
import { predecessorasPendentes } from "../nucleo/dependencia_demanda.ts";
import { CICLO_DA_DEMANDA, etapaDoEstado } from "../nucleo/ciclos.ts";
import type { DemandaParaDespacho } from "../nucleo/despacho.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import { EstadoDemanda } from "../nucleo/primitivos.ts";
import { carregarDemanda } from "./demandas.ts";
import { predecessorasDaDemanda } from "./dependencias_demanda.ts";
import { processosAbertos } from "./trabalho_agentico.ts";

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

/** Roda `ler` num snapshot só; dentro de `escrever` a leitura já é parte da transação. */
export function noSnapshot<T>(banco: DatabaseSync, ler: () => T): T {
  const propria = !banco.isTransaction;
  if (propria) banco.exec("BEGIN");
  try {
    return ler();
  } finally {
    if (propria) banco.exec("COMMIT");
  }
}

/** Demandas em planejamento, execução, revisão da demanda e encerramento, com o agregado e as predecessoras pendentes. */
export const demandasParaDespacho = (banco: DatabaseSync): DemandaParaDespacho[] =>
  noSnapshot(banco, () =>
    banco
      .prepare(`SELECT id FROM demanda WHERE estado IN ${ESTADOS_LIDOS} ORDER BY rowid`)
      .all()
      .map(({ id }) => ({
        agregado: carregarDemanda(banco, id as string),
        predecessoras_pendentes: predecessorasPendentes(predecessorasDaDemanda(banco, id as string)),
      })),
  );

/** Os tickets com trabalho vivo: execução aberta, com ou sem o pi no ar. */
export const trabalhosVivos = (banco: DatabaseSync): Endereco[] =>
  processosAbertos(banco).map(({ demanda_id, ticket_id }) => Endereco.doTicket(demanda_id, ticket_id));

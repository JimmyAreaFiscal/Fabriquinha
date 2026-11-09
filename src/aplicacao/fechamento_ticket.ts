// Falha do ticket em execução, de qualquer etapa, para quem encerra o processo sem passar pela condução da etapa. O
// fechamento do `implementar` e do `resolver_conflito` (verificar, commitar, concluir ou devolver) é das conduções.
import type { DatabaseSync } from "node:sqlite";
import type { TicketDemanda } from "../nucleo/agregado_demanda.ts";
import type { FalhaDaTentativa } from "../nucleo/tentativa.ts";
import { registrarFalhaTicket } from "../nucleo/transicoes_demanda.ts";
import { comDemanda } from "../armazenamento/demandas.ts";
import { instanteAtual } from "./relogio.ts";

type Ref = Pick<TicketDemanda, "demanda_id" | "ticket_id">;

/** Falha o ticket em execução, de qualquer etapa, com a falha tipada, sem coletar, devolver nem gravar evidência; síncrona para os encerramentos órfãos. */
export function falharTicketDemanda(banco: DatabaseSync, ref: Ref, falha: FalhaDaTentativa): void {
  comDemanda(banco, ref.demanda_id, (ag) =>
    ag.tickets.find((t) => t.ticket_id === ref.ticket_id)?.estado === "em_execucao"
      ? registrarFalhaTicket(ag, { ticket_id: ref.ticket_id, falha }, instanteAtual())
      : ag,
  );
}

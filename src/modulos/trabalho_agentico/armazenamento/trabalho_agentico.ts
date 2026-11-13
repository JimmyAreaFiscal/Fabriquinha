// provisório: remover no ticket 22. As sessões, as execuções e o Uso delas mudaram para src/modulos/sessoes/, pela
// fachada, com os nomes de lá; aqui ficam os nomes antigos e a correlação com o endereço do ticket.
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import { formatarTicketRef, type TicketRef } from "../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts";
import {
  carregarSessoesDoContexto,
  type SessoesDoContexto,
  execucoesAbertas,
  sessaoDeCadaTicketDasDemandas,
} from "../../sessoes/publico.ts";

export {
  comSessoesDoContexto as comTrabalhosDoTicket,
  contextoDaExecucao as ticketDoProcesso,
  contextoDaSessao as ticketDoTrabalho,
  execucaoVivaDoToken as processoVivoDoToken,
  execucoesAbertas as processosAbertos,
  gravarAmbienteDaExecucao as gravarAmbienteDoProcesso,
  gravarTokenDaExecucao as gravarTokenDoProcesso,
  sessaoDeCadaTicketDasDemandas,
  sessoesDaDemanda as trabalhosComTicketDaDemanda,
} from "../../sessoes/publico.ts";

export const carregarTrabalhosDoTicket = (banco: DatabaseSync, ref: z.infer<typeof TicketRef>): SessoesDoContexto =>
  carregarSessoesDoContexto(banco, ref);

/** @testes provisório: remover no ticket 22 (a Condução lê de `carregarSessoesDoContexto`, pela fachada de Sessões) */
export const carregarTrabalhosDaDemanda = (banco: DatabaseSync, demandaId: string): SessoesDoContexto =>
  carregarSessoesDoContexto(banco, { demanda_id: demandaId, ticket_id: null });

/**
 * Os tickets (`I-n.Tm`) com o pi no ar: execução aberta e com o grupo do pi gravado. A execução abre antes da preparação
 * da worktree e o grupo só é gravado quando o pi sobe; a coleta de evidências roda depois que ela fecha.
 */
export const ticketsComPiAtivo = (banco: DatabaseSync): Set<string> =>
  new Set(
    execucoesAbertas(banco)
      .filter((e) => e.grupo_processo !== null)
      .map(({ demanda_id, ticket_id }) => formatarTicketRef({ demanda_id, ticket_id })),
  );

/** O id da sessão de cada ticket da demanda; com mais de uma no ticket, vale a mais recente. */
export const sessaoDeCadaTicketDaDemanda = (banco: DatabaseSync, id: string): Map<number, string> =>
  new Map(sessaoDeCadaTicketDasDemandas(banco, [id]).get(id));

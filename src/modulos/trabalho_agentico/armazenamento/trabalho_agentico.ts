// provisório: remover no ticket 22. As sessões, as execuções e o Uso delas mudaram para src/modulos/sessoes/, pela
// fachada, com os nomes de lá; aqui ficam os nomes antigos e a correlação com o endereço do ticket.
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import type { TicketRef } from "../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts";
import { carregarSessoesDoContexto, type SessoesDoContexto } from "../../sessoes/publico.ts";

export {
  comSessoesDoContexto as comTrabalhosDoTicket,
  contextoDaExecucao as ticketDoProcesso,
  contextoDaSessao as ticketDoTrabalho,
  execucaoVivaDoToken as processoVivoDoToken,
  execucoesAbertas as processosAbertos,
  gravarAmbienteDaExecucao as gravarAmbienteDoProcesso,
  gravarTokenDaExecucao as gravarTokenDoProcesso,
  sessaoDeCadaTicketDasDemandas,
} from "../../sessoes/publico.ts";

export const carregarTrabalhosDoTicket = (banco: DatabaseSync, ref: z.infer<typeof TicketRef>): SessoesDoContexto =>
  carregarSessoesDoContexto(banco, ref);

/** @testes provisório: remover no ticket 22 (a Condução lê de `carregarSessoesDoContexto`, pela fachada de Sessões) */
export const carregarTrabalhosDaDemanda = (banco: DatabaseSync, demandaId: string): SessoesDoContexto =>
  carregarSessoesDoContexto(banco, { demanda_id: demandaId, ticket_id: null });

// provisório: remover no ticket 22. A varredura dos commits humanos mudou para repositorio/commits e recebe o projeto
// como dado, e o agendamento dela é do servidor (server/fluxos/ciclo_do_servico/varredura_de_commits_humanos.ts); este adaptador acha o
// projeto pelo nome ou pela demanda, como as conduções do Ciclo de Vida ainda pedem.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../../../shared/nucleo/erros.ts";
import {
  registrarCommitsHumanosDoTicket as registrarCommitsHumanosDoTicketDoProjeto,
  varrerCommitsHumanos as varrerCommitsHumanosDoProjeto,
} from "../../repositorio/publico.ts";
import { buscarProjeto, projetoDaDemanda, projetoExistente } from "../../demandas/publico.ts";

/** F6 §4.2 para o commit `sha` do ticket, no projeto da demanda. */
export async function registrarCommitsHumanosDoTicket(
  banco: DatabaseSync,
  demandaId: string,
  ticketId: number,
  sha: string,
): Promise<void> {
  const nomeDoProjeto = projetoDaDemanda(banco, demandaId);
  const projeto = nomeDoProjeto === undefined ? undefined : buscarProjeto(banco, nomeDoProjeto);
  if (projeto === undefined) {
    throw new ErroDeInexistente(`a demanda ${demandaId} não existe`, "confira o número da demanda");
  }
  await registrarCommitsHumanosDoTicketDoProjeto(banco, projeto, demandaId, ticketId, sha);
}

/** F6 §4.4 no projeto cadastrado com o nome `nomeDoProjeto`. */
export async function varrerCommitsHumanos(banco: DatabaseSync, nomeDoProjeto: string): Promise<void> {
  await varrerCommitsHumanosDoProjeto(banco, projetoExistente(banco, nomeDoProjeto, "cadastre-o na Configuração"));
}

// provisório: remover no ticket 22. A varredura dos commits humanos mudou para repositorio/commits e recebe o projeto
// como dado; este adaptador acha o projeto pelo nome ou pela demanda, como os chamadores ainda pedem, até o ticket 20
// levar o agendamento para o servidor.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../../../shared/nucleo/erros.ts";
import { type Relogio, relogioDoSistema } from "../../../shared/nucleo/relogio.ts";
import {
  projetosAVarrer as projetosAVarrerDaLista,
  registrarCommitsHumanosDoTicket as registrarCommitsHumanosDoTicketDoProjeto,
  varrerCommitsHumanos as varrerCommitsHumanosDoProjeto,
} from "../../repositorio/publico.ts";
import { buscarProjeto, listarProjetos, projetoDaDemanda, projetoExistente } from "../../demandas/publico.ts";

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

/** F4 §4, passo 1, sobre todos os projetos cadastrados. */
export const projetosAVarrer = (banco: DatabaseSync, relogio: Relogio = relogioDoSistema): string[] =>
  projetosAVarrerDaLista(
    banco,
    listarProjetos(banco).map((projeto) => projeto.nome),
    relogio,
  );

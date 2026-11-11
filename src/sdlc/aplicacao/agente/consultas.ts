// As leituras do agente: o próprio projeto, a própria demanda e o próprio ticket, sempre pelo endereço público (`I-206.T3`).
// O ticket sai sem `criado_por` e a decisão com `por` em texto (o tipo do Ator), como antes do Ator único; o motivo do
// ticket que falhou vem da última Tentativa dele.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda, TicketDemanda } from "../../nucleo/demanda/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../nucleo/demanda/demanda.ts";
import { schemaDoTipo } from "../../../qualidade/nucleo/evidencias/evidencia.ts";
import { motivoDaFalhaDoTicket } from "../../nucleo/tentativa.ts";
import { carregarDemanda } from "../../armazenamento/demandas.ts";
import { visaoDaDemanda } from "../consultas/visao_da_demanda.ts";
import { projetoExistente } from "../../../projeto/aplicacao/cadastro.ts";
import {
  escopoDoProcessoAberto,
  exigirDemandaPropria,
  exigirTicket,
  exigirTicketProprio,
  type ProcessoDoAgente,
} from "./escopo.ts";

const ticketParaAgente = (ticket: TicketDemanda, agregado: AgregadoDemanda) => {
  const { demanda_id, ticket_id, rodada_id, criado_por: _, ...resto } = ticket;
  const motivo = motivoDaFalhaDoTicket(agregado.tentativas, ticket);
  return {
    ticket: formatarTicketRef({ demanda_id, ticket_id }),
    ...(rodada_id !== undefined && { rodada: formatarRodadaRef({ demanda_id, rodada_id }) }),
    ...resto,
    ...(motivo !== undefined && { motivo }),
  };
};

/**
 * O projeto da demanda do agente.
 */
export function verProjeto(banco: DatabaseSync, processo: ProcessoDoAgente) {
  const agente = escopoDoProcessoAberto(banco, processo);
  return projetoExistente(banco, agente.projeto, "confira a execução");
}

/**
 * A própria demanda do agente (`demanda`, como o `I-<n>` dela): a demanda, as rodadas, as decisões e os tickets; só o
 * próprio ticket mostra evidências, com o nome, quando foi e o `veredito` que o schema do tipo deriva.
 */
export function verDemanda(banco: DatabaseSync, processo: ProcessoDoAgente, demanda: string) {
  const agente = escopoDoProcessoAberto(banco, processo);
  exigirDemandaPropria(agente, demanda);
  const { agregado } = visaoDaDemanda(banco, agente.demanda_id);
  return {
    demanda: agregado.demanda,
    rodadas: agregado.rodadas.map(({ demanda_id, rodada_id, ...r }) => ({
      rodada: formatarRodadaRef({ demanda_id, rodada_id }),
      ...r,
    })),
    // A rodada vem do ticket decidido: a decisão não a guarda.
    decisoes: agregado.decisoes.map(({ demanda_id, ticket_id, decisao_id, por, ...d }) => {
      const rodada_id = agregado.tickets.find((t) => t.ticket_id === ticket_id)?.rodada_id;
      return {
        ticket: formatarTicketRef({ demanda_id, ticket_id }),
        ...(rodada_id !== undefined && { rodada: formatarRodadaRef({ demanda_id, rodada_id }) }),
        ...d,
        por: por.tipo,
      };
    }),
    tickets: agregado.tickets.map((t) => ({
      ...ticketParaAgente(t, agregado),
      ...(t.ticket_id === agente.ticket_id && {
        evidencias: agregado.evidencias
          .filter((e) => e.ticket_id === t.ticket_id)
          .map((e) => ({ tipo: e.tipo, em: e.em, veredito: schemaDoTipo(e.tipo).veredito?.(e.dados) })),
      }),
    })),
  };
}

/**
 * O próprio ticket do agente (`ticket`, como o `I-<n>.T<m>` dele).
 */
export function verTicket(banco: DatabaseSync, processo: ProcessoDoAgente, ticket: string) {
  const agente = escopoDoProcessoAberto(banco, processo);
  exigirTicketProprio(agente, ticket);
  const agregado = carregarDemanda(banco, agente.demanda_id);
  return ticketParaAgente(exigirTicket(agregado, agente.ticket_id), agregado);
}

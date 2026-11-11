// O modelo e o effort que o ticket usa (D07): o do ticket, senão o da etapa do projeto, senão o padrão do harness.
import type { TicketDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { type ConfiguracaoAgente, resolverConfiguracaoAgente } from "../nucleo/configuracao_agente.ts";
import type { Projeto } from "../../projeto/nucleo/projeto.ts";

export const resolverModeloEffort = (ticket: TicketDemanda, etapasDoProjeto: Projeto["etapas"]): ConfiguracaoAgente =>
  resolverConfiguracaoAgente({
    ticket: ticket.configuracao_agente,
    etapaDoProjeto: etapasDoProjeto.find((e) => e.etapa === ticket.etapa)?.configuracao_agente,
    padrao: {},
  });

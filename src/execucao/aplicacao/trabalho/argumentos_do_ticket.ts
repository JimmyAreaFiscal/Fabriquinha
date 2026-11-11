// As skills e os argumentos do agente para as etapas do SDLC por demandas (comparacao-sdlc-implementacao.md §§8 e 11,
// D07), pelo harness do condutor.
import type { TicketDemanda } from "../../../demanda/nucleo/agregado_demanda.ts";
import { resolverConfiguracaoAgente } from "../../nucleo/configuracao_agente.ts";
import type { Projeto } from "../../../ambiente/nucleo/projeto.ts";
import { CATALOGO_DE_ETAPAS } from "../../../fluxo/nucleo/etapa.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import type { LancamentoDoTicket } from "../../../harness/harness.ts";
import { condutor } from "./condutor.ts";

/** As skills da etapa nova: as das capacidades do catálogo que o harness tem. */
export const skillsDaEtapaDemanda = (etapa: EtapaTicket): string[] =>
  condutor.harness.skillsDisponiveis(CATALOGO_DE_ETAPAS[etapa].capacidades.skills);

/** Os argumentos do agente para o ticket da demanda: skills do catálogo novo, modelo e effort pela D07. */
export function argumentosDoAgenteDoTicket({
  ticket,
  etapasDoProjeto,
  ...resto
}: Omit<LancamentoDoTicket, "skills" | "modelo" | "effort"> & {
  ticket: TicketDemanda;
  etapasDoProjeto: Projeto["etapas"];
}): string[] {
  const { modelo, effort } = resolverConfiguracaoAgente({
    ticket: ticket.configuracao_agente,
    etapaDoProjeto: etapasDoProjeto.find((e) => e.etapa === ticket.etapa)?.configuracao_agente,
    padrao: {},
  });
  return condutor.harness.argumentos({ ...resto, skills: skillsDaEtapaDemanda(ticket.etapa), modelo, effort });
}

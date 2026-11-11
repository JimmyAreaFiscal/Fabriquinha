// O agente do ticket para as etapas do SDLC por demandas (comparacao-sdlc-implementacao.md §§8 e 11, D07): as skills
// do catálogo da etapa e o modelo e o effort resolvidos; o harness faz dele a linha de comando.
import type { TicketDemanda } from "../../../demanda/nucleo/agregado_demanda.ts";
import { resolverConfiguracaoAgente } from "../../nucleo/configuracao_agente.ts";
import type { Projeto } from "../../../ambiente/nucleo/projeto.ts";
import { CATALOGO_DE_ETAPAS } from "../../../fluxo/nucleo/etapa.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import type { LancamentoDoTicket } from "../../../harness/harness.ts";

/** As skills da etapa nova: as das capacidades do catálogo; o harness leva só as que o pacote dele tem. */
export const skillsDaEtapaDemanda = (etapa: EtapaTicket): readonly string[] =>
  CATALOGO_DE_ETAPAS[etapa].capacidades.skills;

/** O lançamento do agente do ticket da demanda: skills do catálogo novo, modelo e effort pela D07. */
export function lancamentoDoTicket({
  ticket,
  etapasDoProjeto,
  ...resto
}: Omit<LancamentoDoTicket, "tipo" | "skills" | "modelo" | "effort"> & {
  ticket: TicketDemanda;
  etapasDoProjeto: Projeto["etapas"];
}): LancamentoDoTicket {
  const { modelo, effort } = resolverConfiguracaoAgente({
    ticket: ticket.configuracao_agente,
    etapaDoProjeto: etapasDoProjeto.find((e) => e.etapa === ticket.etapa)?.configuracao_agente,
    padrao: {},
  });
  return { ...resto, tipo: "ticket", skills: skillsDaEtapaDemanda(ticket.etapa), modelo, effort };
}

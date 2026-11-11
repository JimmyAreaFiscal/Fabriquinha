// Skills e argumentos do pi para as etapas do SDLC por demandas (comparacao-sdlc-implementacao.md §§8 e 11, D07).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TicketDemanda } from "../../../demanda/nucleo/agregado_demanda.ts";
import { resolverConfiguracaoAgente } from "../../nucleo/configuracao_agente.ts";
import type { Projeto } from "../../../ambiente/nucleo/projeto.ts";
import { CATALOGO_DE_ETAPAS } from "../../../fluxo/nucleo/etapa.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import { HarnessPi, type Lancamento } from "../../infra/harness_pi.ts";
import { PACOTE } from "../../infra/pi.ts";

const existe = (skill: string, pacote: string): boolean => existsSync(join(pacote, "skills", skill));

/** As skills da etapa nova: as das capacidades do catálogo que existem no pacote. */
export const skillsDaEtapaDemanda = (etapa: EtapaTicket, pacote = PACOTE): string[] =>
  CATALOGO_DE_ETAPAS[etapa].capacidades.skills.filter((s) => existe(s, pacote));

/** Os argumentos do pi para o ticket da demanda: skills do catálogo novo, modelo e effort pela D07. */
export function argumentosPiDemanda({
  ticket,
  etapasDoProjeto,
  ...resto
}: Omit<Lancamento, "skills" | "modelo" | "effort"> & {
  ticket: TicketDemanda;
  etapasDoProjeto: Projeto["etapas"];
}): string[] {
  const { modelo, effort } = resolverConfiguracaoAgente({
    ticket: ticket.configuracao_agente,
    etapaDoProjeto: etapasDoProjeto.find((e) => e.etapa === ticket.etapa)?.configuracao_agente,
    padrao: {},
  });
  return new HarnessPi().argumentos({ ...resto, skills: skillsDaEtapaDemanda(ticket.etapa), modelo, effort });
}

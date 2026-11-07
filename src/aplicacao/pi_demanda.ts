// Skills e argumentos do pi para as etapas do SDLC por demandas (comparacao-sdlc-implementacao.md §§8 e 11, D07).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TicketDemanda } from "../nucleo/agregado_demanda.ts";
import type { Projeto } from "../nucleo/configuracao_projeto.ts";
import { catalogoDaEtapa } from "../nucleo/evidencia_etapa.ts";
import type { EtapaTicket } from "../nucleo/primitivos.ts";
import { resolverModeloEffort } from "../nucleo/resolucao_ticket.ts";
import { argumentosPi, PACOTE, skillDoTipo, type Lancamento } from "../infra/agente/pi.ts";

const existe = (skill: string, pacote: string): boolean => existsSync(join(pacote, "skills", skill));

const doAgente = (etapa: EtapaTicket): string[] =>
  catalogoDaEtapa(etapa)
    .filter((c) => c.produtor === "agente")
    .map((c) => skillDoTipo(c.tipo));

/** As skills de artefato da etapa nova: as do catálogo que existem no pacote. */
export const skillsDaEtapaDemanda = (etapa: EtapaTicket, pacote = PACOTE): string[] =>
  doAgente(etapa).filter((s) => existe(s, pacote));

/** Os argumentos do pi para o ticket da demanda: skills do catálogo novo, modelo e effort pela D07. */
export function argumentosPiDemanda({
  ticket,
  etapasDoProjeto,
  ...resto
}: Omit<Lancamento, "skills" | "modelo" | "effort"> & {
  ticket: TicketDemanda;
  etapasDoProjeto: Projeto["etapas"];
}): string[] {
  const { modelo, effort } = resolverModeloEffort(
    ticket,
    etapasDoProjeto.find((e) => e.etapa === ticket.etapa),
  );
  return argumentosPi({
    ...resto,
    skills: skillsDaEtapaDemanda(ticket.etapa),
    modelo: modelo.valor && { provedor: modelo.valor.provedor, modelo: modelo.valor.nome },
    effort: effort.valor,
  });
}

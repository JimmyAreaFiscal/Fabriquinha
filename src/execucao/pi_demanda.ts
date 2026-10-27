// Skills e argumentos do pi para as etapas do SDLC por demandas (comparacao-sdlc-implementacao.md §§8 e 11, D07).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TicketDemanda } from "../dominio/agregado_demanda.ts";
import type { Projeto } from "../dominio/configuracao_projeto.ts";
import { CATALOGO_ETAPAS, catalogoDaEtapa } from "../dominio/evidencia_etapa.ts";
import type { EtapaTicket } from "../dominio/primitivos.ts";
import { resolverModeloEffort } from "../dominio/resolucao_ticket.ts";
import { argumentosPi, PACOTE, skillDoTipo, type Lancamento } from "./pi.ts";

const existe = (skill: string, pacote: string): boolean => existsSync(join(pacote, "skills", skill));

const doAgente = (etapa: EtapaTicket): string[] =>
  catalogoDaEtapa(etapa)
    .filter((c) => c.produtor === "agente")
    .map((c) => skillDoTipo(c.tipo));

/** As skills de artefato da etapa nova: as do catálogo que existem no pacote; as ausentes são `skillsPendentes`. */
export const skillsDaEtapaDemanda = (etapa: EtapaTicket, pacote = PACOTE): string[] =>
  doAgente(etapa).filter((s) => existe(s, pacote));

/** As skills que o catálogo exige e o pacote ainda não tem, em ordem estável (a do catálogo) e sem repetição. */
export const skillsPendentes = (pacote = PACOTE): string[] => [
  ...new Set(
    CATALOGO_ETAPAS.filter((c) => c.produtor === "agente")
      .map((c) => skillDoTipo(c.tipo))
      .filter((s) => !existe(s, pacote)),
  ),
];

/** Os argumentos do pi para o ticket da demanda: skills do catálogo novo, modelo e effort pela D07. */
export function argumentosPiDemanda({
  ticket,
  etapasDoProjeto,
  ...resto
}: Omit<Lancamento, "etapa" | "skills" | "modelo" | "effort"> & {
  ticket: TicketDemanda;
  etapasDoProjeto: Projeto["etapas"];
}): string[] {
  const { modelo, effort } = resolverModeloEffort(
    ticket,
    etapasDoProjeto.find((e) => e.etapa === ticket.etapa),
  );
  return argumentosPi({
    ...resto,
    etapa: ticket.etapa,
    skills: skillsDaEtapaDemanda(ticket.etapa),
    modelo: modelo.valor && { provedor: modelo.valor.provedor, modelo: modelo.valor.nome },
    effort: effort.valor,
  });
}

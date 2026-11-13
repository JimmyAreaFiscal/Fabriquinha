import type { AgregadoDemanda } from "../src/modulos/ciclo_de_vida/processo/nucleo/agregado/agregado_demanda.ts";
import { Endereco } from "../src/modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";

/** structuredClone perde o protótipo de Endereco; o snapshot precisa preservar as identidades do domínio. */
export function clonarAgregadoDemanda(agregado: AgregadoDemanda): AgregadoDemanda {
  const copia = structuredClone(agregado);
  copia.tentativas = copia.tentativas.map((tentativa) => ({
    ...tentativa,
    ticket: Endereco.doTicket(tentativa.ticket.demanda_id, Number(tentativa.ticket.ticket_id)),
  }));
  return copia;
}

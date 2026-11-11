import type { AgregadoDemanda } from "../src/sdlc/nucleo/demanda/agregado_demanda.ts";
import { Endereco } from "../src/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";

/** structuredClone perde o protótipo de Endereco; o snapshot precisa preservar as identidades do domínio. */
export function clonarAgregadoDemanda(agregado: AgregadoDemanda): AgregadoDemanda {
  const copia = structuredClone(agregado);
  copia.tentativas = copia.tentativas.map((tentativa) => ({
    ...tentativa,
    ticket: Endereco.doTicket(tentativa.ticket.demanda_id, Number(tentativa.ticket.ticket_id)),
  }));
  return copia;
}

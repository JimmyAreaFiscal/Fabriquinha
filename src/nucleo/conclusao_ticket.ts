// Conclusão do ticket `implementar` da demanda SDLC (comparacao-sdlc-implementacao.md §4 e D05): em_execucao → concluido.
import { z } from "zod";
import { type Ator, exigirAtor } from "./ator.ts";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { formatarTicketRef } from "./demanda.ts";
import { CICLO_DO_TICKET } from "./ciclos.ts";
import { ErroDeRegra } from "./erros.ts";
import { evidenciasPendentes } from "./evidencia.ts";
import { CATALOGO_ETAPAS } from "./evidencia_etapa.ts";
import { Id } from "./primitivos.ts";
import { type ContextoDemanda, exigirDemandaEmAndamento, mudarTicket, ticketDaDemanda } from "./transicoes_demanda.ts";

const EntradaConclusao = z.strictObject({ ticket_id: Id });

/** Só a Fabriquinha conclui, só `implementar` em execução e sem evidência pendente; zera as devoluções. */
export function concluirTicketImplementar(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAtor(ator, "concluir o ticket", "fabriquinha");
  const { ticket_id } = EntradaConclusao.parse(entrada);
  exigirDemandaEmAndamento(ag, "concluir");
  const ticket = ticketDaDemanda(ag, ticket_id);
  CICLO_DO_TICKET.exigir(ticket, "em_execucao");
  const ref = formatarTicketRef(ticket);
  if (ticket.etapa !== "implementar") {
    throw new ErroDeRegra(
      `o ticket ${ref} é da etapa ${ticket.etapa} e não é concluído por aqui`,
      "só implementar; as demais etapas têm conclusão própria",
    );
  }
  const pendencias = evidenciasPendentes(ag, ticket, CATALOGO_ETAPAS);
  if (pendencias.length > 0) {
    throw new ErroDeRegra(
      `o ticket ${ref} tem pendências de evidência: ${pendencias.map((t) => `${t} (ausente)`).join(", ")}`,
      "complete as verificações da aplicação e tente de novo",
    );
  }
  return mudarTicket(ag, ticket, "concluido", ctx.agora);
}

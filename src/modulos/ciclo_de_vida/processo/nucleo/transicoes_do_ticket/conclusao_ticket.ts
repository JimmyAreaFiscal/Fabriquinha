// Conclusão do ticket `implementar` da demanda SDLC (comparacao-sdlc-implementacao.md §4 e D05): em_execucao → concluido.
import { z } from "zod";
import { type Ator, CATALOGO_ETAPAS, exigirAtor, formatarTicketRef } from "../../../etapas/publico.ts";
import type { AgregadoDemanda } from "../agregado/agregado_demanda.ts";
import { CICLO_DO_TICKET, PRIMEIRA_ETAPA_DA_RODADA } from "../ciclos/ciclos.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { evidenciasPendentes } from "../../../evidencias/publico.ts";
import { Id } from "../../../../../shared/nucleo/primitivos.ts";
import {
  type ContextoDemanda,
  exigirDemandaEmAndamento,
  mudarTicket,
  ticketDaDemanda,
} from "../transicoes/transicoes_demanda.ts";

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
  if (ticket.etapa !== PRIMEIRA_ETAPA_DA_RODADA) {
    throw new ErroDeRegra(
      `o ticket ${ref} é da etapa ${ticket.etapa} e não é concluído por aqui`,
      `só ${PRIMEIRA_ETAPA_DA_RODADA}; as demais etapas têm conclusão própria`,
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

// Conclusão do ticket `implementar` da demanda SDLC (comparacao-sdlc-implementacao.md §4 e D05): em_execucao → concluido.
import { z } from "zod";
import { type Ator, exigirFabriquinha } from "./agregado.ts";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { formatarTicketRef } from "./demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import { type EvidenciaEtapa, pendenciasDoTicket } from "./evidencia_etapa.ts";
import { Id } from "./primitivos.ts";
import { comStatus, type ContextoDemanda, exigirDemandaEmAndamento, ticketEmStatus } from "./transicoes_demanda.ts";

const EntradaConclusao = z.strictObject({ ticket_id: Id });

/** Só a Fabriquinha conclui, só `implementar` em execução e sem pendências de evidência; zera as devoluções. */
export function concluirTicketImplementar(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
  evidencias: readonly EvidenciaEtapa[],
): AgregadoDemanda {
  exigirFabriquinha(ator, "concluir o ticket");
  const { ticket_id } = EntradaConclusao.parse(entrada);
  exigirDemandaEmAndamento(ag, "concluir");
  const ticket = ticketEmStatus(ag, ticket_id, "em_execucao", "ser concluído");
  const ref = formatarTicketRef(ticket);
  if (ticket.etapa !== "implementar") {
    throw new ErroDeRegra(
      `o ticket ${ref} é da etapa ${ticket.etapa} e não é concluído por aqui`,
      "só implementar; as demais etapas têm conclusão própria",
    );
  }
  const { ausentes, reprovadas } = pendenciasDoTicket(
    { demanda_id: ticket.demanda_id, ticket_id, etapa: ticket.etapa },
    evidencias,
  );
  const pendencias = [...ausentes.map((t) => `${t} (ausente)`), ...reprovadas.map((t) => `${t} (reprovado)`)];
  if (pendencias.length > 0) {
    throw new ErroDeRegra(
      `o ticket ${ref} tem pendências de evidência: ${pendencias.join(", ")}`,
      "complete as verificações da aplicação e tente de novo",
    );
  }
  return comStatus(ag, ticket, { status: "concluido", devolucoes: 0, status_alterado_em: ctx.agora });
}

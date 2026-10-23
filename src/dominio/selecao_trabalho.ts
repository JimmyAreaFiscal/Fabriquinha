// Seleção determinística de trabalho da demanda SDLC (comparacao-sdlc-implementacao.md §4.1): o agente não escolhe.
import type { AgregadoDemanda, TicketDemanda } from "./agregado_demanda.ts";

/** Por rodada em `desenvolvimento`, o `implementar` aberto de menor `ticket_id` com dependências concluídas; global em execução ou falho bloqueia tudo. */
export function selecionarTrabalho(ag: AgregadoDemanda): TicketDemanda[] {
  if (ag.demanda.fase !== "execucao") return [];
  const status = new Map(ag.tickets.map((t) => [t.ticket_id, t.status]));
  if (ag.tickets.some((t) => t.rodada_id === undefined && (t.status === "falhou" || t.status === "em_execucao")))
    return [];
  const concluida = new Set(ag.rodadas.filter((r) => r.fase === "concluida").map((r) => r.rodada_id));
  const dependeDe = (de: number, quem: { rodada_id: number; depende_rodada_id: number }[]) =>
    quem.filter((d) => d.rodada_id === de).map((d) => d.depende_rodada_id);
  const escolhidos: TicketDemanda[] = [];
  for (const rodada of ag.rodadas.filter((r) => r.fase === "desenvolvimento")) {
    const tickets = ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id && t.etapa === "implementar");
    const livre =
      dependeDe(rodada.rodada_id, ag.dependencias_rodada).every((d) => concluida.has(d)) &&
      !tickets.some((t) => t.status === "em_execucao" || t.status === "falhou");
    const prontos = tickets
      .filter(
        (t) =>
          t.status === "aberto" &&
          ag.dependencias_ticket
            .filter((d) => d.ticket_id === t.ticket_id)
            .every((d) => status.get(d.depende_ticket_id) === "concluido"),
      )
      .sort((a, b) => a.ticket_id - b.ticket_id);
    if (livre && prontos[0] !== undefined) escolhidos.push(prontos[0]);
  }
  return escolhidos;
}

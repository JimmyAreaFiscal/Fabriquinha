// Reserva do ticket da demanda SDLC (comparacao-sdlc-implementacao.md §4.1): aberto → em_execucao, só se a seleção o escolhe.
import { z } from "zod";
import { type Ator, exigirFabriquinha } from "./agregado.ts";
import type { AgregadoDemanda, TicketDemanda } from "./agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "./demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import { Id } from "./primitivos.ts";
import { selecionarTrabalho } from "./selecao_trabalho.ts";
import { comStatus, type ContextoDemanda, exigirDemandaEmAndamento, ticketEmStatus } from "./transicoes_demanda.ts";

const EntradaReserva = z.strictObject({ ticket_id: Id });

const ocupado = (t: TicketDemanda) => t.status === "falhou" || t.status === "em_execucao";

/** Por que a seleção não escolheu o ticket, na ordem de `selecionarTrabalho`. */
function impedimento(ag: AgregadoDemanda, t: TicketDemanda, predecessorasSatisfeitas: boolean): [string, string] {
  const { id: demanda_id, fase } = ag.demanda;
  const ref = (ticket_id: number) => formatarTicketRef({ demanda_id, ticket_id });
  const concluido = (ticket_id: number) =>
    ag.tickets.some((x) => x.ticket_id === ticket_id && x.status === "concluido");
  if (fase === "planejamento" && t.etapa === "planejar" && !predecessorasSatisfeitas) {
    return ["as predecessoras da demanda ainda não foram satisfeitas", "espere as predecessoras serem satisfeitas"];
  }
  const global = ag.tickets.find((x) => x.rodada_id === undefined && ocupado(x));
  if (fase === "execucao" && global) {
    return [`o ticket ${ref(global.ticket_id)} da demanda está ${global.status}`, "espere ele ser resolvido"];
  }
  const dep = ag.dependencias_ticket.find((d) => d.ticket_id === t.ticket_id && !concluido(d.depende_ticket_id));
  if (dep) return [`depende do ticket ${ref(dep.depende_ticket_id)}, ainda não concluído`, "espere a conclusão dele"];
  const depRodada = ag.dependencias_rodada.find(
    (d) =>
      d.rodada_id === t.rodada_id &&
      !ag.rodadas.some((r) => r.rodada_id === d.depende_rodada_id && r.fase === "concluida"),
  );
  if (depRodada) {
    const rodada = formatarRodadaRef({ demanda_id, rodada_id: depRodada.depende_rodada_id });
    return [`a rodada ${rodada} da qual a sua depende não foi concluída`, "espere a conclusão dela"];
  }
  const outro = ag.tickets.find((x) => x.rodada_id === t.rodada_id && ocupado(x));
  if (outro) return [`o ticket ${ref(outro.ticket_id)} da rodada está ${outro.status}`, "espere ele ser resolvido"];
  const escolhido = selecionarTrabalho(ag, predecessorasSatisfeitas).find(
    (x) => x.etapa === t.etapa && x.rodada_id === t.rodada_id,
  );
  if (escolhido) return [`o ticket ${ref(escolhido.ticket_id)} aberto vem antes`, "reserve o de menor id"];
  return [`a etapa ${t.etapa} não é a do trabalho da fase ${fase}`, "só o trabalho elegível da fase"];
}

/** CA-1 a CA-7: só a Fabriquinha reserva, e só o ticket aberto que `selecionarTrabalho` escolhe; vira `em_execucao`. */
export function reservarTicket(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
  predecessorasSatisfeitas: boolean,
): AgregadoDemanda {
  exigirFabriquinha(ator, "reservar o ticket");
  const { ticket_id } = EntradaReserva.parse(entrada);
  exigirDemandaEmAndamento(ag, "reservar");
  const ticket = ticketEmStatus(ag, ticket_id, "aberto", "ser reservado");
  if (!selecionarTrabalho(ag, predecessorasSatisfeitas).includes(ticket)) {
    const [motivo, orientacao] = impedimento(ag, ticket, predecessorasSatisfeitas);
    throw new ErroDeRegra(`o ticket ${formatarTicketRef(ticket)} não pode ser reservado: ${motivo}`, orientacao);
  }
  return comStatus(ag, ticket, { status: "em_execucao", status_alterado_em: ctx.agora });
}

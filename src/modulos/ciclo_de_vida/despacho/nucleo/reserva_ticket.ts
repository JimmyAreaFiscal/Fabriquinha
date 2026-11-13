// A seleção que a reserva do ticket exige (MELHORIAS §5.2, regra 6): o ticket aberto só vai a em_execucao se o Despacho o
// seleciona, e a recusa diz por quê. É a mesma para o ciclo do agendador e para o "Executar agora"; a transição é do
// Processo, que a grava na unidade de trabalho que lê o agregado.
import { Endereco, formatarTicketRef } from "../../etapas/publico.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../processo/publico.ts";
import { Despacho, motivoDeRecusaDoItem, type ResultadoDoDespacho, situacaoDeUmaDemanda } from "./despacho.ts";
import { ErroDeRegra, existe } from "../../../../shared/nucleo/erros.ts";

/** Por que o Despacho não escolheu o ticket: o motivo da recusa dele ou, sem recusa, quem vem antes dele. */
function impedimento(
  ag: AgregadoDemanda,
  t: TicketDemanda,
  { prontos, recusas }: ResultadoDoDespacho,
): [string, string] {
  const ref = (ticket_id: number) => formatarTicketRef({ demanda_id: ag.demanda.id, ticket_id });
  const recusa = motivoDeRecusaDoItem(recusas, Endereco.doTicket(ag.demanda.id, t.ticket_id));
  if (recusa?.tipo === "dependencia_pendente") {
    const ticketPendente = recusa.aguarda.find((x) => x.ticket_id !== undefined);
    if (ticketPendente)
      return [`depende do ticket ${String(ticketPendente)}, ainda não concluído`, "espere a conclusão dele"];
    const rodadaPendente = recusa.aguarda.find((x) => x.rodada_id !== undefined);
    if (rodadaPendente) {
      return [`a rodada ${String(rodadaPendente)} da qual a sua depende não foi concluída`, "espere a conclusão dela"];
    }
    return ["as predecessoras da demanda ainda não foram satisfeitas", "espere as predecessoras serem satisfeitas"];
  }
  if (recusa?.tipo === "ocupado") {
    const ocupante = existe(
      ag.tickets.find((x) => ref(x.ticket_id) === String(recusa.por)),
      `o ticket ${String(recusa.por)} não existe`,
      "confira o endereço do ticket",
    );
    const onde = ocupante.rodada_id === undefined ? "da demanda" : "da rodada";
    return [`o ticket ${ref(ocupante.ticket_id)} ${onde} está ${ocupante.estado}`, "espere ele ser resolvido"];
  }
  const escolhido = prontos.find((x) => x.etapa === t.etapa && x.rodada_id === t.rodada_id);
  if (escolhido) return [`o ticket ${ref(escolhido.ticket_id)} aberto vem antes`, "reserve o de menor id"];
  return [`a etapa ${t.etapa} não é a do trabalho do estado ${ag.demanda.estado}`, "só o trabalho elegível do estado"];
}

/** A recusa do ticket que o Despacho não seleciona, com o motivo: a reserva só leva a `em_execucao` o selecionado. */
export function exigirSelecaoDoDespacho(
  ag: AgregadoDemanda,
  ticket: TicketDemanda,
  predecessorasSatisfeitas: boolean,
): void {
  const selecao = new Despacho().selecionar(situacaoDeUmaDemanda(ag, predecessorasSatisfeitas));
  if (!selecao.prontos.includes(ticket)) {
    const [motivo, orientacao] = impedimento(ag, ticket, selecao);
    throw new ErroDeRegra(`o ticket ${formatarTicketRef(ticket)} não pode ser reservado: ${motivo}`, orientacao);
  }
}

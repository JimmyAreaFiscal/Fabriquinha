// Condução de uma revisão (comparacao-sdlc-implementacao.md §§4.2, 6): reserva o ticket, prepara as evidências da
// Fabriquinha, roda o pi e, se a execução falhou ou terminou sem a decisão, registra a falha no ticket. Nunca grava a
// decisão (CA-2, CA-12): quem a grava é o agente, por `revisao decidir`.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import { formatarTicketRef } from "../nucleo/demanda.ts";
import { encontrado, mensagem } from "../nucleo/erros.ts";
import { reservarTicket } from "../nucleo/reserva_ticket.ts";
import { type FalhaDaTentativa, falhaQueExigeOAuditor, retornoAoAgenteDoTicket } from "../nucleo/tentativa.ts";
import { registrarFalhaTicket } from "../nucleo/transicoes_demanda.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { iniciarExecucaoDemanda, type OpcoesExecucaoDemanda } from "./execucao_demanda.ts";

export interface OpcoesRevisao extends Pick<OpcoesExecucaoDemanda, "limiteMin" | "modo"> {
  /** Gancho entre a reserva e o pi (as evidências da rodada); se lançar, o ticket falha sem rodar o pi. */
  preparar?: () => void | Promise<void>;
}

export type ResultadoRevisao = "decidida" | "falhou";

const agora = () => ({ agora: new Date().toISOString() });

/** Ticket de revisão em execução e sem decisão: o pi roda na worktree da rodada, ou na da demanda se o ticket é global. */
export async function conduzirRevisao(
  banco: DatabaseSync,
  ref: { demanda_id: string; ticket_id: number },
  opcoes: OpcoesRevisao,
): Promise<ResultadoRevisao> {
  const { demanda_id, ticket_id } = ref;
  const doTicket = () =>
    encontrado(
      carregarDemanda(banco, demanda_id).tickets.find((t) => t.ticket_id === ticket_id),
      `o ticket ${formatarTicketRef(ref)} não existe`,
      "use um ticket da demanda",
    );
  comDemanda(banco, demanda_id, (ag) => reservarTicket(ag, { ticket_id }, FABRIQUINHA, agora(), true));
  const falhar = (falha: FalhaDaTentativa): ResultadoRevisao => {
    comDemanda(banco, demanda_id, (ag) => registrarFalhaTicket(ag, { ticket_id, falha }, agora()));
    return "falhou";
  };
  try {
    await opcoes.preparar?.();
  } catch (error_) {
    return falhar(falhaQueExigeOAuditor(`preparação da revisão falhou: ${mensagem(error_)}`));
  }
  const retomada = retornoAoAgenteDoTicket(carregarDemanda(banco, demanda_id).tentativas, ticket_id);
  const falha = await iniciarExecucaoDemanda(banco, ref, { ...opcoes, ...(retomada && { retomada }) }).fim;
  if (falha !== undefined) return falhar(falha);
  // A decisão conclui o ticket; ainda em execução, o revisor saiu sem decidir e o ticket ficaria preso.
  return doTicket().estado === "em_execucao"
    ? falhar(falhaQueExigeOAuditor("a revisão terminou sem registrar a decisão"))
    : "decidida";
}

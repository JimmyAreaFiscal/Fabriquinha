// Condução de uma revisão (comparacao-sdlc-implementacao.md §§4.2, 6): reserva o ticket, prepara as evidências da
// Fabriquinha, roda o pi e, se a execução falhou ou terminou sem a decisão, registra a falha no ticket. Nunca grava a
// decisão (CA-2, CA-12): quem a grava é o agente, por `revisao decidir`.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import { formatarTicketRef } from "../dominio/demanda.ts";
import { encontrado, mensagem } from "../dominio/erros.ts";
import { reservarTicket } from "../dominio/reserva_ticket.ts";
import { registrarFalhaTicket } from "../dominio/transicoes_demanda.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { carregarSessoesDoTicket } from "../persistencia/sessoes.ts";
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
  const { instrucao } = doTicket();
  comDemanda(banco, demanda_id, (ag) => reservarTicket(ag, { ticket_id }, FABRIQUINHA, agora(), true));
  const falhar = (motivo: string): ResultadoRevisao => {
    comDemanda(banco, demanda_id, (ag) => registrarFalhaTicket(ag, { ticket_id, motivo }, agora()));
    return "falhou";
  };
  try {
    await opcoes.preparar?.();
  } catch (error_) {
    return falhar(`preparação da revisão falhou: ${mensagem(error_)}`);
  }
  const { id, fim } = iniciarExecucaoDemanda(banco, ref, {
    ...opcoes,
    ...(instrucao !== undefined && { retomada: { tipo: "reabertura", motivo: instrucao } }),
  });
  await fim;
  // `erro` só é gravado na execução que falhou.
  const erro = carregarSessoesDoTicket(banco, ref).execucoes.find((e) => e.id === id)?.erro;
  if (erro !== undefined) return falhar(erro);
  // A decisão conclui o ticket; ainda em execução, o revisor saiu sem decidir e o ticket ficaria preso.
  return doTicket().status === "em_execucao" ? falhar("a revisão terminou sem registrar a decisão") : "decidida";
}

// Serviço Planejamento da demanda (comparacao-sdlc-implementacao.md §§3 e 6): junta reserva, sessão interativa e plano.
// Só orquestra as regras do domínio; a decisão do gate e a preparação das worktrees são de `gates/planejamento.ts`.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { CICLO_DA_DEMANDA } from "../nucleo/ciclos.ts";
import { predecessorasPendentes } from "../nucleo/dependencia_demanda.ts";
import { ErroDeRegra, existe } from "../nucleo/erros.ts";
import { Endereco, ticketAtualDaEtapa } from "../nucleo/item_de_trabalho.ts";
import { montarRetornoAoAgente, retornoAoAgenteDoTicket, tentativaAnteriorEmMemoria } from "../nucleo/tentativa.ts";
import { reservarTicket } from "../nucleo/reserva_ticket.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../armazenamento/dependencias_demanda.ts";
import { carregarTrabalhosDoTicket } from "../armazenamento/trabalho_agentico.ts";
import { iniciarExecucaoDemanda } from "./execucao_demanda.ts";

const contexto = () => ({ agora: new Date().toISOString() });

function ticketPlanejar(ag: AgregadoDemanda) {
  return existe(
    ticketAtualDaEtapa(ag, "planejar"),
    `a demanda ${ag.demanda.id} não tem ticket de etapa planejar`,
    "abra o ticket de planejamento",
  );
}

/**
 * Reserva o `planejar` (só com as predecessoras satisfeitas) e conduz a sessão interativa; com o ticket já em execução
 * só retoma a mesma sessão. Reprovada, a retomada leva o motivo da última decisão; reaberta, a instrução do ticket.
 */
export function iniciarOuRetomarPlanejamento(
  banco: DatabaseSync,
  demandaId: string,
  limiteMin: number,
): ReturnType<typeof iniciarExecucaoDemanda> {
  const ag = carregarDemanda(banco, demandaId);
  CICLO_DA_DEMANDA.exigir(ag.demanda, "planejar");
  const ticket = ticketPlanejar(ag);
  if (ticket.estado === "aberto") {
    const satisfeitas = predecessorasPendentes(predecessorasDaDemanda(banco, demandaId)).length === 0;
    comDemanda(banco, demandaId, (a) =>
      reservarTicket(a, { ticket_id: ticket.ticket_id }, FABRIQUINHA, contexto(), satisfeitas),
    );
  } else if (ticket.estado !== "em_execucao") {
    throw new ErroDeRegra(
      `o ticket de planejamento da demanda ${demandaId} está ${ticket.estado} e não pode ser iniciado`,
      "só se inicia ou retoma o planejamento com o ticket aberto ou em execução",
    );
  }
  const ref = { demanda_id: demandaId, ticket_id: ticket.ticket_id };
  const ultima = ag.decisoes.filter((d) => d.ticket_id === ticket.ticket_id).at(-1);
  // A reprovação é o último fato da conversa: o motivo dela vem antes da instrução, que pode ser de uma reabertura
  // anterior (ou a cópia do próprio motivo, quando a reprovação reabriu o ticket falho).
  const enderecoDoTicket = Endereco.doTicket(demandaId, ticket.ticket_id);
  const retomada =
    ultima?.resultado === "reprovado"
      ? montarRetornoAoAgente(
          tentativaAnteriorEmMemoria(enderecoDoTicket, {
            motivoDaReprovacao: existe(ultima.motivo, "a reprovação não tem motivo", "confira o banco"),
          }),
        )
      : retornoAoAgenteDoTicket(ag.tentativas, ticket.ticket_id);
  // Plano aprovado e depois descartado: a conversa que o produziu não volta, senão o agente reenvia o mesmo plano. O
  // replanejamento começa em sessão nova; já começado (execução depois da aprovação), é ele que se retoma.
  const iniciarEmSessaoNova =
    ultima?.resultado === "aprovado" &&
    !carregarTrabalhosDoTicket(banco, ref).execucoes.some((e) => e.inicio >= ultima.em);
  return iniciarExecucaoDemanda(banco, ref, { limiteMin, modo: "interativo", retomada, iniciarEmSessaoNova });
}

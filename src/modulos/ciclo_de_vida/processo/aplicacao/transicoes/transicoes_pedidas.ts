// As transições que a Condução e o Despacho pedem ao Processo (MELHORIAS §11, regra 1): cada uma abre a unidade de
// trabalho da demanda, aplica a transição do agregado no instante do relógio e grava; quem pede só diz qual transição e
// com que dados, e o Processo é o único que grava o estado do desenvolvimento.
import type { DatabaseSync } from "node:sqlite";
import type { Modelo } from "../../../../sessoes/publico.ts";
import { type Relogio, relogioDoSistema } from "../../../../../shared/nucleo/relogio.ts";
import { type Ator, type Endereco, FABRIQUINHA, type FalhaDaTentativa } from "../../../etapas/publico.ts";
import { PRIMEIRA_ETAPA_DA_RODADA } from "../../nucleo/ciclos/ciclos.ts";
import {
  type AgregadoDemanda,
  comPrDaRodada,
  type PullRequestDoEspaco,
  type TicketDemanda,
} from "../../nucleo/agregado/agregado_demanda.ts";
import type { Gate } from "../../nucleo/agregado/gate_da_demanda.ts";
import { comDemanda } from "../../armazenamento/agregado_da_demanda.ts";
import {
  iniciarTentativaDoTicket,
  reservarTicketAberto,
} from "../../nucleo/transicoes_do_ticket/inicio_da_execucao.ts";
import {
  type ContextoDemanda,
  devolverTicket,
  registrarFalhaTicket,
  retomarTicketFalhoPorInfraestrutura,
  ticketDaDemanda,
} from "../../nucleo/transicoes/transicoes_demanda.ts";
import { concluirTicketImplementar } from "../../nucleo/transicoes_do_ticket/conclusao_ticket.ts";
import {
  concluirImplementacoesRodada,
  concluirSessaoRodada,
  conferirPullRequestRodada,
  registrarCorrecoesSessao,
} from "../../nucleo/transicoes/transicoes_rodada.ts";
import {
  concluirEncerramento,
  concluirResolucaoConflito,
  registrarConflitoEncerramento,
  registrarFalhaEncerramento,
  registrarIntegracao,
  registrarTentativaEncerramento,
  solicitarIntegracao,
} from "../../nucleo/transicoes/transicoes_encerramento.ts";

/** O ticket pelo qual a transição é pedida. */
interface TicketDaTransicao {
  demanda_id: string;
  ticket_id: number;
}

type TransicaoDoAgregado = (ag: AgregadoDemanda, entrada: unknown, ator: Ator, ctx: ContextoDemanda) => AgregadoDemanda;

/** A transição como o Processo a oferece: a demanda, a entrada da transição, quem pede e o relógio. */
const pedidoDa =
  (transicao: TransicaoDoAgregado) =>
  (banco: DatabaseSync, demandaId: string, entrada: unknown, ator: Ator, relogio: Relogio): AgregadoDemanda =>
    comDemanda(banco, demandaId, (ag) => transicao(ag, entrada, ator, { agora: relogio.agora() }));

// O ticket.

/**
 * Reserva o ticket aberto para a Fabriquinha: vai a `em_execucao` só se `exigirSelecao` (a seleção do Despacho) o deixa,
 * na mesma unidade de trabalho que lê o agregado. Atômica: de duas reservas simultâneas, a segunda o acha em execução.
 */
export const reservarTicketSelecionado = (
  banco: DatabaseSync,
  { demanda_id, ticket_id }: TicketDaTransicao,
  relogio: Relogio,
  exigirSelecao: (ag: AgregadoDemanda, ticket: TicketDemanda) => void,
): AgregadoDemanda =>
  comDemanda(banco, demanda_id, (ag) =>
    reservarTicketAberto(ag, { ticket_id }, FABRIQUINHA, { agora: relogio.agora() }, exigirSelecao),
  );

/** Reabre sem o Auditor o ticket que falhou por infraestrutura, com o modelo da retomada quando a política o troca. */
export const retomarFalhaDeInfraestruturaDoTicket = (
  banco: DatabaseSync,
  { demanda_id, ticket_id }: TicketDaTransicao,
  modelo: Modelo | undefined,
  relogio: Relogio,
): AgregadoDemanda =>
  comDemanda(banco, demanda_id, (ag) =>
    retomarTicketFalhoPorInfraestrutura(ag, { ticket_id, ...(modelo && { modelo }) }, FABRIQUINHA, {
      agora: relogio.agora(),
    }),
  );

/** Abre, no início da execução, a Tentativa do ticket que começa a executar, guardando o processo dela. */
export const abrirTentativaDoTicket = (
  banco: DatabaseSync,
  { demanda_id, ticket_id }: TicketDaTransicao,
  execucao: { id: string; inicio: string },
): AgregadoDemanda =>
  comDemanda(banco, demanda_id, (ag) =>
    iniciarTentativaDoTicket(ag, { ticket_id, processo_id: execucao.id }, FABRIQUINHA, { agora: execucao.inicio }),
  );

/** Falha o ticket com a falha tipada. */
export const registrarFalhaDoTicket = (
  banco: DatabaseSync,
  { demanda_id, ticket_id }: TicketDaTransicao,
  falha: FalhaDaTentativa,
  relogio: Relogio,
): AgregadoDemanda =>
  comDemanda(banco, demanda_id, (ag) => registrarFalhaTicket(ag, { ticket_id, falha }, { agora: relogio.agora() }));

/** Falha o ticket só se ele ainda está em execução, de qualquer etapa; síncrona para os encerramentos órfãos. */
export function falharTicketEmExecucao(
  banco: DatabaseSync,
  { demanda_id, ticket_id }: TicketDaTransicao,
  falha: FalhaDaTentativa,
  relogio: Relogio = relogioDoSistema,
): void {
  comDemanda(banco, demanda_id, (ag) =>
    ag.tickets.find((t) => t.ticket_id === ticket_id)?.estado === "em_execucao"
      ? registrarFalhaTicket(ag, { ticket_id, falha }, { agora: relogio.agora() })
      : ag,
  );
}

/** A reprovação técnica (D05): o ticket volta ao agente com a instrução ou, no limite das Tentativas, falha com ela. */
export const devolverTicketAoAgente = (
  banco: DatabaseSync,
  { demanda_id, ticket_id }: TicketDaTransicao,
  instrucao: string,
  relogio: Relogio,
): AgregadoDemanda =>
  comDemanda(banco, demanda_id, (ag) =>
    devolverTicket(ag, { ticket_id, instrucao }, FABRIQUINHA, { agora: relogio.agora() }),
  );

/** Conclui o ticket de implementação e, com o último da rodada concluído, leva a rodada à revisão. */
export const concluirTicketDeImplementacao = (
  banco: DatabaseSync,
  { demanda_id, ticket_id }: TicketDaTransicao,
  relogio: Relogio,
): AgregadoDemanda =>
  comDemanda(banco, demanda_id, (antes) => {
    const ctx = { agora: relogio.agora() };
    const { rodada_id } = ticketDaDemanda(antes, ticket_id);
    const ag = concluirTicketImplementar(antes, { ticket_id }, FABRIQUINHA, ctx);
    const rodada = ag.rodadas.find((r) => r.rodada_id === rodada_id);
    const pendente = ag.tickets.some(
      (t) => t.rodada_id === rodada_id && t.etapa === PRIMEIRA_ETAPA_DA_RODADA && t.estado !== "concluido",
    );
    return rodada?.estado === PRIMEIRA_ETAPA_DA_RODADA && !pendente
      ? concluirImplementacoesRodada(ag, { demanda_id, rodada_id }, FABRIQUINHA, ctx)
      : ag;
  });

// A rodada.

/** Os fatos da conferência do PR da rodada: volta a implementar com as correções ou vai ao gate. */
export const conferirPRDaRodada = pedidoDa(conferirPullRequestRodada);

/** Grava o PR publicado do Espaço da rodada. */
export const registrarPRDaRodada = (
  banco: DatabaseSync,
  demandaId: string,
  rodadaId: number,
  pr: Omit<PullRequestDoEspaco, "rodada_id">,
): AgregadoDemanda => comDemanda(banco, demandaId, (ag) => ({ ...ag, pull_requests: comPrDaRodada(ag, rodadaId, pr) }));

/** O ticket corretivo que o agente da rodada registra. */
export const registrarCorrecoesDaRodada = pedidoDa(registrarCorrecoesSessao);

/** Conclui a sessão de ajustes do PR reprovado e volta a rodada ao desenvolvimento. */
export const concluirSessaoDeAjustes = pedidoDa(concluirSessaoRodada);

/** O ensaio da conclusão da sessão de ajustes: recusa como a conclusão, e nada é gravado. */
export const ensaiarConclusaoDaSessaoDeAjustes = (
  banco: DatabaseSync,
  demandaId: string,
  entrada: unknown,
  ator: Ator,
  relogio: Relogio,
): void => {
  comDemanda(banco, demandaId, (ag) => {
    concluirSessaoRodada(ag, entrada, ator, { agora: relogio.agora() });
    return ag;
  });
};

// O encerramento da demanda.

export const registrarTentativaDoEncerramento = pedidoDa(registrarTentativaEncerramento);
export const registrarConflitoDoEncerramento = pedidoDa(registrarConflitoEncerramento);
export const concluirResolucaoDoConflito = pedidoDa(concluirResolucaoConflito);
export const solicitarIntegracaoFinal = pedidoDa(solicitarIntegracao);
export const registrarIntegracaoFinal = pedidoDa(registrarIntegracao);
export const registrarFalhaDoEncerramento = pedidoDa(registrarFalhaEncerramento);
export const concluirEncerramentoDaDemanda = pedidoDa(concluirEncerramento);

// Os gates.

/** O que quem pede a decisão confere no ticket âncora, na mesma unidade de trabalho: antes e depois de a regra decidir. */
interface ConferenciasDaDecisao {
  antes(ag: AgregadoDemanda, ticket: TicketDemanda): void;
  depois(ag: AgregadoDemanda, ticket: TicketDemanda): void;
}

/** A decisão do gate sobre o agregado da demanda, pela regra dele; a conferência que recusa desfaz tudo. */
export const decidirGateNaDemanda = (
  banco: DatabaseSync,
  regra: Gate,
  endereco: Endereco,
  entrada: unknown,
  ator: Ator,
  relogio: Relogio,
  conferencias?: ConferenciasDaDecisao,
): AgregadoDemanda =>
  comDemanda(banco, endereco.demanda_id, (ag) => {
    const decidir = () => regra.decidir(ag, endereco, entrada, ator, { agora: relogio.agora() });
    if (conferencias === undefined) return decidir();
    const ticket = regra.ancora(ag, endereco);
    conferencias.antes(ag, ticket);
    const decidida = decidir();
    conferencias.depois(ag, ticket);
    return decidida;
  });

/** A aprovação do gate do PR da rodada, com o PR integrado na hospedagem, na mesma unidade de trabalho. */
export const aprovarPRIntegradoDaRodada = (
  banco: DatabaseSync,
  regra: Gate,
  endereco: Endereco,
  entrada: unknown,
  ator: Ator,
  relogio: Relogio,
  pr: { rodada_id: number } & Pick<PullRequestDoEspaco, "numero" | "url" | "head">,
): AgregadoDemanda =>
  comDemanda(banco, endereco.demanda_id, (ag) => {
    const agora = relogio.agora();
    const decidida = regra.decidir(ag, endereco, entrada, ator, { agora });
    const { rodada_id, ...integrado } = pr;
    return {
      ...decidida,
      pull_requests: comPrDaRodada(decidida, rodada_id, { ...integrado, estado: "integrado", atualizado_em: agora }),
    };
  });

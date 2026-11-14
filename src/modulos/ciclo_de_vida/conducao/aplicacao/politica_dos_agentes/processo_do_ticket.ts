// A política do fim do processo de um ticket: o encerramento e o Uso são de Sessões; aqui fica o que a falha significa
// para o ticket, na recuperação dos processos que uma instância anterior do serviço deixou abertos.
import type { DatabaseSync } from "node:sqlite";
import { CATALOGO_DE_ETAPAS, type FalhaDaTentativa, falhaPorServicoReiniciado } from "../../../etapas/publico.ts";
import { type Relogio, relogioDoSistema } from "../../../../../shared/nucleo/relogio.ts";
import type { Execucao, Sessao, SessoesDeAgente } from "../../../../sessoes/publico.ts";
import { ticketsEmExecucaoDasEtapas } from "../../../planejamento/publico.ts";

export type TicketRef = Pick<Sessao, "demanda_id" | "ticket_id">;

/** As execuções das sessões do ticket, sessão a sessão na ordem em que foram criadas. */
export const execucoesDoTicket = (sessoes: Pick<SessoesDeAgente, "listar">, ticket: TicketRef): Execucao[] =>
  sessoes
    .listar({ demandas: [ticket.demanda_id] })
    .filter((s) => s.ticket_id === ticket.ticket_id)
    .flatMap((s) => s.execucoes);

/**
 * As Etapas cujo fechamento roda depois que a execução fecha: as que o agente faz sozinho ou a Fabriquinha faz (as
 * interativas ficam de fora: a retomada do despacho as assume). A Etapa da rodada cujo Gate espera num estado próprio só
 * conta enquanto a rodada está no estado da Etapa: no do Gate, o ticket espera o Auditor.
 * ponytail: só a Etapa da rodada com Gate em estado próprio; a da demanda com Gate assim ficaria de fora, e não há nenhuma.
 */
const etapasFechadasDepoisDaExecucao = Object.values(CATALOGO_DE_ETAPAS).filter(
  ({ executor }) => executor === "agente_autonomo" || executor === "fabriquinha",
);
const ETAPAS_FECHADAS_DEPOIS_DA_EXECUCAO = {
  sempre: etapasFechadasDepoisDaExecucao
    .filter(({ gate }) => gate?.esperaEmEstadoProprio !== true)
    .map(({ nome }) => nome),
  noEstadoDaRodada: etapasFechadasDepoisDaExecucao
    .filter(({ gate, escopo }) => gate?.esperaEmEstadoProprio === true && escopo === "rodada")
    .map(({ nome }) => nome),
};

/** Falha o ticket que ficou sem processo, sem tocar etapa nem gate: é do motor do SDLC, que quem chama entrega. */
export type FalharTicketSemProcesso = (
  banco: DatabaseSync,
  ref: TicketRef,
  falha: FalhaDaTentativa,
  relogio: Relogio,
) => void;

/** Reinício do serviço (§4.2), depois de Sessões encerrar as execuções abertas: o ticket preso sem processo falha. */
export function falharTicketsPresosNaSubida(
  banco: DatabaseSync,
  falharTicket: FalharTicketSemProcesso,
  relogio: Relogio = relogioDoSistema,
): void {
  // Execução já encerrada e fechamento interrompido (coleta, ou entre o commit e a conclusão): sem execução aberta, o
  // ticket `em_execucao` não sairia mais (o `planejar` fica de fora: a retomada do despacho o assume; o gate do PR também). ponytail: falha em vez de repetir o fechamento; repetir fica para quando pedirem.
  const presos = ticketsEmExecucaoDasEtapas(banco, ETAPAS_FECHADAS_DEPOIS_DA_EXECUCAO);
  for (const { demanda_id, ticket_id } of presos) {
    falharTicket(banco, { demanda_id, ticket_id }, falhaPorServicoReiniciado, relogio);
  }
}

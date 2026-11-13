// A política do fim do processo de um ticket: o encerramento e o Uso são de Sessões (`encerrarExecucaoComUso`,
// `registrarUsoDaConsulta`, pela fachada); aqui fica o que a falha significa para o ticket, na recuperação dos processos
// que uma instância anterior do serviço deixou abertos.
import type { DatabaseSync } from "node:sqlite";
import { CATALOGO_DE_ETAPAS, type FalhaDaTentativa, falhaPorServicoReiniciado } from "../../../etapas/publico.ts";
import { type Relogio, relogioDoSistema } from "../../../../../shared/nucleo/relogio.ts";
import { encerrarExecucaoOrfa, type Harness, pastasDoProcesso, type Sessao } from "../../../../sessoes/publico.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { ticketsEmExecucaoDasEtapas } from "../../../planejamento/publico.ts";

export type TicketRef = Pick<Sessao, "demanda_id" | "ticket_id">;

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

/** Avisa quem assina a sessão que o estado dela pode ter mudado (`condutor.avisar`). */
type AvisarSessao = (sessao: string, log: string) => void;

/** Falha o ticket que ficou sem processo, sem tocar etapa nem gate: é do motor do SDLC, que quem chama entrega. */
export type FalharTicketSemProcesso = (
  banco: DatabaseSync,
  ref: TicketRef,
  falha: FalhaDaTentativa,
  relogio: Relogio,
) => void;

/** Quem lê o Uso da sessão do agente: o harness do condutor. */
type LeitorDeUso = Pick<Harness, "lerUsoDaSessao">;

/** Processo aberto sem condutor: encerra com falha e falha o ticket em execução, sem tocar etapa nem gate. O pi já foi morto. */
export function encerrarProcessoOrfao(
  banco: DatabaseSync,
  ref: TicketRef,
  id: string,
  falha: FalhaDaTentativa,
  avisar: AvisarSessao,
  harness: LeitorDeUso,
  falharTicket: FalharTicketSemProcesso,
  relogio: Relogio = relogioDoSistema,
): void {
  const { log } = pastasDoProcesso(raizDo(banco), id);
  const sessao = encerrarExecucaoOrfa(banco, ref, id, log, harness, relogio);
  falharTicket(banco, ref, falha, relogio);
  avisar(sessao, log);
}

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

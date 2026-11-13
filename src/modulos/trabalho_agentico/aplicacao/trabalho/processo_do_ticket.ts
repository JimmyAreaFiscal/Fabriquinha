// provisório: o ticket 15 absorve na Condução. A política do fim do processo de um ticket: o encerramento e o Uso são de
// Sessões (`encerrarExecucaoComUso`, `registrarUsoDaConsulta`, pela fachada); aqui fica o que a falha significa para o
// ticket, na recuperação dos processos que uma instância anterior do serviço deixou abertos.
import type { DatabaseSync } from "node:sqlite";
import { type FalhaDaTentativa, falhaPorServicoReiniciado } from "../../../ciclo_de_vida/publico.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { encerrarExecucaoOrfa, execucoesAbertas, type Harness, type Sessao } from "../../../sessoes/publico.ts";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import { ticketsEmExecucaoSemProcesso } from "../../armazenamento/trabalho_agentico.ts";
import { pastasDoProcesso } from "../../../compartilhado/infra/registro.ts";

export {
  encerrarExecucaoComUso as encerrarProcessoDoTicket,
  registrarUsoDaConsulta,
} from "../../../sessoes/publico.ts";

export type TicketRef = Pick<Sessao, "demanda_id" | "ticket_id">;

/** Avisa quem assina a sessão que o estado dela pode ter mudado (`CondutorDeTrabalhos.avisar`). */
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

/** Reinício do serviço (§4.2): todo processo aberto é de uma instância anterior e falha, sem avançar etapa nem gate. */
export function recuperarProcessosAbertos(
  banco: DatabaseSync,
  avisar: AvisarSessao,
  harness: LeitorDeUso,
  falharTicket: FalharTicketSemProcesso,
  relogio: Relogio = relogioDoSistema,
): void {
  for (const { id, demanda_id, ticket_id } of execucoesAbertas(banco)) {
    const ref = { demanda_id, ticket_id };
    encerrarProcessoOrfao(banco, ref, id, falhaPorServicoReiniciado, avisar, harness, falharTicket, relogio);
  }
  // Execução já encerrada e fechamento interrompido (coleta, ou entre o commit e a conclusão): sem execução aberta, o
  // ticket `em_execucao` não sairia mais (o `planejar` fica de fora: a retomada do despacho o assume; o gate do PR também). ponytail: falha em vez de repetir o fechamento; repetir fica para quando pedirem.
  const presos = ticketsEmExecucaoSemProcesso(banco);
  for (const { demanda_id, ticket_id } of presos) {
    falharTicket(banco, { demanda_id, ticket_id }, falhaPorServicoReiniciado, relogio);
  }
}

// O que o banco guarda de cada processo de um ticket: o fim com a falha e o uso na mesma transação, e a recuperação
// dos processos que uma instância anterior do serviço deixou abertos. Quem mata o pi é o `CondutorDeTrabalhos`.
import type { DatabaseSync } from "node:sqlite";
import { existe, mensagem } from "../../../compartilhado/nucleo/erros.ts";
import { falhaPorServicoReiniciado, type FalhaDaTentativa } from "../../../sdlc/nucleo/tentativa.ts";
import {
  acumularUso,
  encerrarProcesso,
  type ProcessoDoTrabalho,
  type TrabalhoGerenciado,
  type UsoModeloExecucao,
} from "../../nucleo/trabalho_agentico.ts";
import { type Relogio, relogioDoSistema } from "../../../compartilhado/nucleo/relogio.ts";
import { colunasDoModelo, type LinhaDeUso } from "../../../custos/nucleo/uso.ts";
import { raizDo } from "../../../compartilhado/armazenamento/banco.ts";
import {
  carregarTrabalhosDoTicket,
  comTrabalhosDoTicket,
  processosAbertos,
  ticketsEmExecucaoSemProcesso,
} from "../../armazenamento/trabalho_agentico.ts";
import { anotar, pastasDoProcesso } from "../../../compartilhado/infra/registro.ts";
import type { Harness } from "../../../harness/harness.ts";
import { falharTicketDemanda } from "../../../sdlc/aplicacao/despacho/fechamento_ticket.ts";

export type TicketRef = Pick<TrabalhoGerenciado, "demanda_id" | "ticket_id">;

interface ProcessoEncerravel {
  banco: DatabaseSync;
  ref: TicketRef;
  sessao: TrabalhoGerenciado;
  execucao: ProcessoDoTrabalho;
}

/** Avisa quem assina a sessão que o estado dela pode ter mudado (`CondutorDeTrabalhos.avisar`). */
export type AvisarSessao = (sessao: string, log: string) => void;

/** A linha de Uso como o banco a guarda, na execução; custo desconhecido fica sem a chave, nunca zero. */
const usoDaExecucao = (execucao_id: string, l: LinhaDeUso): UsoModeloExecucao => ({
  execucao_id,
  ...colunasDoModelo(l.modelo),
  tokens_entrada: l.tokens_entrada,
  tokens_saida: l.tokens_saida,
  tokens_cache_leitura: l.tokens_cache_leitura,
  tokens_cache_escrita: l.tokens_cache_escrita,
  ...(l.custo !== null && { custo: l.custo }),
});

/** Quem lê o Uso da sessão do agente: o harness do condutor. */
type LeitorDeUso = Pick<Harness, "lerUsoDaSessao">;

/** O uso por modelo da janela da execução; custo ausente ou parcial fica nulo, nunca zero. */
function coletarUso(c: ProcessoEncerravel, fim: string, log: string, harness: LeitorDeUso): UsoModeloExecucao[] {
  try {
    return harness
      .lerUsoDaSessao(raizDo(c.banco), c.sessao.id, Date.parse(c.execucao.inicio), Date.parse(fim))
      .map((l) => usoDaExecucao(c.execucao.id, l));
  } catch (error_) {
    // Métrica nunca impede o encerramento.
    anotar(log, `coleta de uso falhou: ${mensagem(error_)}`);
    return [];
  }
}

/** O único escritor do encerramento: fim, falha e uso na mesma transação; não toca ticket, etapa nem gate. */
export function encerrarProcessoDoTicket(
  c: ProcessoEncerravel,
  falhou: boolean,
  log: string,
  harness: LeitorDeUso,
  relogio: Relogio = relogioDoSistema,
): void {
  const fim = relogio.agora();
  const usos = coletarUso(c, fim, log, harness);
  comTrabalhosDoTicket(c.banco, c.ref, (estado) => ({
    ...estado,
    execucoes: encerrarProcesso(estado.execucoes, c.execucao.id, fim, falhou),
    // Soma, não substitui: a execução pode já ter o Uso de uma consulta (`registrarUsoDaConsulta`).
    usos: usos.reduce((acc, u) => acumularUso(acc, u), estado.usos),
  }));
}

/** Soma o Uso de uma consulta à execução do ticket que a pediu, para ele contar no ticket e na rodada dele. */
export function registrarUsoDaConsulta(
  banco: DatabaseSync,
  ref: TicketRef,
  execucao: string,
  linhas: readonly LinhaDeUso[],
): void {
  comTrabalhosDoTicket(banco, ref, (estado) => ({
    ...estado,
    usos: linhas.reduce((acc, l) => acumularUso(acc, usoDaExecucao(execucao, l)), estado.usos),
  }));
}

/** Processo aberto sem condutor: encerra com falha e falha o ticket em execução, sem tocar etapa nem gate. O pi já foi morto. */
export function encerrarProcessoOrfao(
  banco: DatabaseSync,
  ref: TicketRef,
  id: string,
  falha: FalhaDaTentativa,
  avisar: AvisarSessao,
  harness: LeitorDeUso,
  relogio: Relogio = relogioDoSistema,
): void {
  const { sessoes, execucoes } = carregarTrabalhosDoTicket(banco, ref);
  const execucao = existe(
    execucoes.find((e) => e.id === id),
    `a execução ${id} não existe`,
    "confira o banco",
  );
  const sessao = existe(
    sessoes.find((s) => s.id === execucao.trabalho_id),
    `a execução ${id} não tem sessão`,
    "confira o banco",
  );
  const { log } = pastasDoProcesso(raizDo(banco), id);
  encerrarProcessoDoTicket({ banco, ref, sessao, execucao }, true, log, harness, relogio);
  falharTicketDemanda(banco, ref, falha, relogio);
  avisar(sessao.id, log);
}

/** Reinício do serviço (§4.2): todo processo aberto é de uma instância anterior e falha, sem avançar etapa nem gate. */
export function recuperarProcessosAbertos(
  banco: DatabaseSync,
  avisar: AvisarSessao,
  harness: LeitorDeUso,
  relogio: Relogio = relogioDoSistema,
): void {
  for (const { id, demanda_id, ticket_id } of processosAbertos(banco)) {
    encerrarProcessoOrfao(banco, { demanda_id, ticket_id }, id, falhaPorServicoReiniciado, avisar, harness, relogio);
  }
  // Execução já encerrada e fechamento interrompido (coleta, ou entre o commit e a conclusão): sem execução aberta, o
  // ticket `em_execucao` não sairia mais (o `planejar` fica de fora: a retomada do despacho o assume; o gate do PR também). ponytail: falha em vez de repetir o fechamento; repetir fica para quando pedirem.
  const presos = ticketsEmExecucaoSemProcesso(banco);
  for (const { demanda_id, ticket_id } of presos) {
    falharTicketDemanda(banco, { demanda_id, ticket_id }, falhaPorServicoReiniciado, relogio);
  }
}

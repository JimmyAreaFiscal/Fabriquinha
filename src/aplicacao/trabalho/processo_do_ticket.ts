// O que o banco guarda de cada processo de um ticket: o fim com a falha e o uso na mesma transação, e a recuperação
// dos processos que uma instância anterior do serviço deixou abertos. Quem mata o pi é o `CondutorDeTrabalhos`.
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { existe, mensagem } from "../../nucleo/erros.ts";
import { falhaPorServicoReiniciado, type FalhaDaTentativa } from "../../nucleo/tentativa.ts";
import {
  encerrarProcesso,
  registrarUso,
  type ProcessoDoTrabalho,
  type TrabalhoGerenciado,
  type UsoModeloExecucao,
} from "../../nucleo/trabalho_agentico.ts";
import { somar } from "../../nucleo/uso.ts";
import { raizDo } from "../../armazenamento/banco.ts";
import {
  carregarTrabalhosDoTicket,
  comTrabalhosDoTicket,
  processosAbertos,
} from "../../armazenamento/trabalho_agentico.ts";
import { HarnessPi } from "../../infra/agente/harness_pi.ts";
import { anotar, pastasDoProcesso } from "../../infra/registro.ts";
import { falharTicketDemanda } from "../fechamento_ticket.ts";

export type TicketRef = Pick<TrabalhoGerenciado, "demanda_id" | "ticket_id">;

interface ProcessoEncerravel {
  banco: DatabaseSync;
  ref: TicketRef;
  sessao: TrabalhoGerenciado;
  execucao: ProcessoDoTrabalho;
}

/** Avisa quem assina a sessão que o estado dela pode ter mudado (`CondutorDeTrabalhos.avisar`). */
export type AvisarSessao = (sessao: string, log: string) => void;

/** O uso por modelo da janela da execução; custo ausente ou parcial fica nulo, nunca zero. */
function coletarUso(c: ProcessoEncerravel, fim: string, log: string): UsoModeloExecucao[] {
  try {
    const arquivo = new HarnessPi().arquivoDaSessao(raizDo(c.banco), c.sessao.id);
    const somas = arquivo ? somar(readFileSync(arquivo, "utf8"), Date.parse(c.execucao.inicio), Date.parse(fim)) : [];
    return somas.map((s) => ({
      execucao_id: c.execucao.id,
      modelo_provedor: s.provedor,
      modelo_nome: s.modelo,
      tokens_entrada: s.input,
      tokens_saida: s.output,
      tokens_cache_leitura: s.cacheRead,
      tokens_cache_escrita: s.cacheWrite,
      ...(!s.semCusto && { custo: s.custo }),
    }));
  } catch (error_) {
    // Métrica nunca impede o encerramento.
    anotar(log, `coleta de uso falhou: ${mensagem(error_)}`);
    return [];
  }
}

/** O único escritor do encerramento: fim, falha e uso na mesma transação; não toca ticket, etapa nem gate. */
export function encerrarProcessoDoTicket(c: ProcessoEncerravel, falhou: boolean, log: string): void {
  const fim = new Date().toISOString();
  const usos = coletarUso(c, fim, log);
  comTrabalhosDoTicket(c.banco, c.ref, (estado) => ({
    ...estado,
    execucoes: encerrarProcesso(estado.execucoes, c.execucao.id, fim, falhou),
    usos: usos.reduce((acc, u) => registrarUso(acc, u), estado.usos),
  }));
}

/** Processo aberto sem condutor: encerra com falha e falha o ticket em execução, sem tocar etapa nem gate. O pi já foi morto. */
export function encerrarProcessoOrfao(
  banco: DatabaseSync,
  ref: TicketRef,
  id: string,
  falha: FalhaDaTentativa,
  avisar: AvisarSessao,
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
  encerrarProcessoDoTicket({ banco, ref, sessao, execucao }, true, log);
  falharTicketDemanda(banco, ref, falha);
  avisar(sessao.id, log);
}

/** Reinício do serviço (§4.2): todo processo aberto é de uma instância anterior e falha, sem avançar etapa nem gate. */
export function recuperarProcessosAbertos(banco: DatabaseSync, avisar: AvisarSessao): void {
  for (const { id, demanda_id, ticket_id } of processosAbertos(banco)) {
    encerrarProcessoOrfao(banco, { demanda_id, ticket_id }, id, falhaPorServicoReiniciado, avisar);
  }
  // Execução já encerrada e fechamento interrompido (coleta, ou entre o commit e a conclusão): sem execução aberta, o
  // ticket `em_execucao` não sairia mais (o `planejar` fica de fora: a retomada do despacho o assume; o gate do PR também). ponytail: falha em vez de repetir o fechamento; repetir fica para quando pedirem.
  const presos = banco
    .prepare(
      `SELECT demanda_id, ticket_id FROM ticket_demanda t WHERE estado = 'em_execucao' AND (
         etapa IN ('implementar', 'resolver_conflito', 'encerrar_demanda', 'revisar_rodada', 'revisar_demanda')
         OR (etapa = 'encerrar_rodada' AND EXISTS (SELECT 1 FROM rodada r
           WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id AND r.estado = 'encerrar_rodada')))`,
    )
    .all() as unknown as TicketRef[];
  for (const { demanda_id, ticket_id } of presos) {
    falharTicketDemanda(banco, { demanda_id, ticket_id }, falhaPorServicoReiniciado);
  }
}

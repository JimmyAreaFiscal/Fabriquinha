// Execução autônoma de um ticket (F4 §6.2): C5, worktree, pi em modo RPC até `agent_settled` (pelo gerente de
// sessões), coleta depois do pi e C7; qualquer falha termina em C6 + C8 com o que faltou.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import { concluirTicket } from "../dominio/conclusao.ts";
import { ErroDeReprovacao, encontrado, mensagem } from "../dominio/erros.ts";
import { devolverTicket, falharTicket, terminarExecucao, ticketDe } from "../dominio/execucao.ts";
import { type Id, motivo } from "../dominio/primitivos.ts";
import { antesDoPi, depoisDoPi } from "../evidencias/coleta.ts";
import { depoisDoC6 } from "../metricas/uso.ts";
import { registrarRetrabalho } from "../metricas/retrabalho.ts";
import { raizDo } from "../persistencia/banco.ts";
import { commitDoTicket } from "../persistencia/commits.ts";
import { anotar, logDaExecucao } from "../persistencia/execucoes.ts";
import { agregadoDoTicket, comIssue } from "../persistencia/issues.ts";
import { avisar, foiCancelada, iniciarNaSessaoPrincipal, rodarExecucao } from "./gerente.ts";
import { montarPrompt } from "./prompt.ts";

// ponytail: limite fixo; vira configuração do projeto se 2 devoluções seguidas não bastarem.
const LIMITE_DE_DEVOLUCOES = 2;

export interface OpcoesAutonoma {
  /** Tempo limite de tempo ativo (F4 §3, §6.7). */
  timeoutMin: number;
}

/**
 * F4 §6.2: executa o ticket autônomo do início ao fim. Erro de C5 (ticket não elegível, issue já com execução) sobe
 * sem lançar nada; dali em diante, toda falha vira C6 + C8, e a promessa só rejeita se o próprio banco falhar.
 */
export async function executarAutonomo(banco: DatabaseSync, ticket: Id, opcoes: OpcoesAutonoma): Promise<void> {
  const issue = encontrado(
    agregadoDoTicket(banco, ticket),
    `o ticket T-${String(ticket)} não existe`,
    "confira o número do ticket",
  ).issue.id;
  // C5 consome a instrução; o prompt a leva primeiro (F4 §6.4).
  const { ag, execucao, instrucao } = iniciarNaSessaoPrincipal(banco, issue, ticket, "autonomo");
  const t = ticketDe(ag, ticket);
  const log = logDaExecucao(raizDo(banco), execucao.id);
  const falhar = (erro: string) => {
    comIssue(banco, issue, "falharTicket", FABRIQUINHA, (a) =>
      falharTicket(a, { ticket, erro: motivo(erro) }, FABRIQUINHA),
    );
    anotar(log, `T-${String(ticket)} falhou: ${erro}`);
    avisar(execucao.sessaoPi, log);
  };

  const { worktree, falha } = await rodarExecucao({
    banco,
    ag,
    execucao,
    limiteMin: opcoes.timeoutMin,
    // F3 §7: a coleta antes do pi entra no prompt; a falha dela vira C6 + C8 como qualquer passo da execução.
    prompt: async (c) =>
      montarPrompt({ ag: await antesDoPi(banco, ag, t, log), ticket: t, instrucao, ...c, modo: "autonomo" }),
  });

  // A issue foi cancelada (C22): o cancelamento já gravou o término e o uso, e a guarda recusaria o resto.
  if (foiCancelada(execucao.id)) return;
  if (falha !== undefined) {
    comIssue(banco, issue, "terminarExecucao", FABRIQUINHA, (a, ctx) =>
      terminarExecucao(a, { execucao: execucao.id, resultado: "falha", erro: motivo(falha) }, FABRIQUINHA, ctx),
    );
    depoisDoC6(banco, execucao.id);
    falhar(falha);
    return;
  }
  comIssue(banco, issue, "terminarExecucao", FABRIQUINHA, (a, ctx) =>
    terminarExecucao(a, { execucao: execucao.id, resultado: "sucesso" }, FABRIQUINHA, ctx),
  );
  depoisDoC6(banco, execucao.id);
  anotar(log, "pi terminou bem; coleta depois do pi");
  try {
    const naConclusao = await depoisDoPi(banco, t, worktree, log);
    comIssue(banco, issue, "concluirTicket", FABRIQUINHA, (a, ctx) => {
      // F5 §4, passo 4: o commit do desenvolvimento é gravado na transação do C7, que o exige; o encerramento entrega
      // os problemas do PR no contexto.
      return concluirTicket(a, { ticket }, FABRIQUINHA, naConclusao?.(banco, ctx) ?? ctx);
    });
    anotar(log, `T-${String(ticket)} concluído`);
    // F5 §4, passo 5: o retrabalho do commit do desenvolvimento; a falha só vai para o log (F6 §4.2).
    const sha = commitDoTicket(banco, ticket);
    if (sha !== undefined) {
      await registrarRetrabalho(banco, ticket, sha).catch((error_: unknown) => {
        anotar(log, `registrarRetrabalho falhou: ${mensagem(error_)}`);
      });
    }
    avisar(execucao.sessaoPi, log);
  } catch (error_) {
    // O código reprovou num gate: o agente corrige, até LIMITE_DE_DEVOLUCOES vezes seguidas; dali, o Auditor decide.
    const devolucoes = (t.devolucoes ?? 0) + 1;
    if (!(error_ instanceof ErroDeReprovacao) || devolucoes > LIMITE_DE_DEVOLUCOES) {
      falhar(mensagem(error_));
      return;
    }
    const instrucao =
      `A Fabriquinha devolveu T-${String(ticket)} pela ${String(devolucoes)}ª vez de ` +
      `${String(LIMITE_DE_DEVOLUCOES)}: ${error_.message}. Corrija o código na worktree e termine de novo; ` +
      "não faça commit.";
    comIssue(banco, issue, "devolverTicket", FABRIQUINHA, (a) => devolverTicket(a, { ticket, instrucao }, FABRIQUINHA));
    anotar(log, `T-${String(ticket)} devolvido ao agente: ${error_.message}`);
    avisar(execucao.sessaoPi, log);
  }
}

// Cancelamento da issue com execução viva (F4, cancelamento; C22): para os pis das atingidas, grava o C22 e conta o uso.
import type { DatabaseSync } from "node:sqlite";
import { AUDITOR } from "../dominio/agregado.ts";
import { exigirCancelavel } from "../dominio/issue.ts";
import type { Id } from "../dominio/primitivos.ts";
import { depoisDoC6 } from "../metricas/uso.ts";
import { raizDo } from "../persistencia/banco.ts";
import { anotar, logDaExecucao } from "../persistencia/execucoes.ts";
import { agregadoExistente, cancelarIssues, dependentes } from "../persistencia/issues.ts";
import { execucoesEmAndamento } from "../persistencia/servico.ts";
import { avisar, pararParaCancelar } from "./gerente.ts";

/**
 * Cancela a issue e as dependentes. Confere o C22 antes de tocar em qualquer pi; depois de parar os pis, grava tudo
 * numa transação e, para cada execução que terminou, conta o uso (C6), anota no log e avisa quem assina a sessão.
 */
export async function cancelarIssue(banco: DatabaseSync, issue: Id): Promise<{ canceladas: Id[] }> {
  exigirCancelavel(agregadoExistente(banco, issue), AUDITOR);
  const alvo = new Set([issue, ...dependentes(banco, issue).map((d) => d.id)]);
  for (const e of execucoesEmAndamento(banco).filter((e) => alvo.has(e.issue))) await pararParaCancelar(e.id);

  const { issues, execucoes } = cancelarIssues(banco, issue, AUDITOR);
  for (const e of execucoes) {
    // Idempotente: a execução que começou entre a lista e o C22 também fica marcada e sem pi.
    await pararParaCancelar(e.id);
    depoisDoC6(banco, e.id);
    const log = logDaExecucao(raizDo(banco), e.id);
    anotar(log, `E-${String(e.id)} cancelada com a I-${String(issue)} pelo Auditor`);
    avisar(e.sessaoPi, log);
  }
  return { canceladas: issues };
}

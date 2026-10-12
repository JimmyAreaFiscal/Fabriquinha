// Arquivos e dados de uma execução fora do agregado (F2 §2, F4 §6.1.2, §7): o diretório `<raiz>/execucoes/E-<n>/`, o
// `log` dele e o grupo de processos do pi.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Id } from "../dominio/primitivos.ts";

/** `<raiz>/execucoes/E-<n>`: `log`, `prompt.md` e `saida/` da execução. */
export const dirDaExecucao = (raiz: string, execucao: Id): string => join(raiz, "execucoes", `E-${String(execucao)}`);

/** Uma linha com horário no log da execução (`<dirDaExecucao>/log`). */
export const anotar = (log: string, texto: string): void => {
  appendFileSync(log, `${new Date().toISOString()} ${texto}\n`);
};

/** Grava o grupo de processos do pi, que o reinício do serviço mata (F4 §7); não é do domínio. */
export const gravarPgid = (banco: DatabaseSync, execucao: Id, pgid: number): void => {
  banco.prepare("UPDATE execucao SET pgid_pi = ? WHERE id = ?").run(pgid, execucao);
};

/** O `log` da execução. */
export const logDaExecucao = (raiz: string, execucao: Id): string => join(dirDaExecucao(raiz, execucao), "log");

/** As issues com alguma execução, do projeto e da issue pedidos, em ordem (F4 §5.3). */
export const issuesComSessao = (banco: DatabaseSync, filtro: { projeto?: string; issue?: Id }): Id[] =>
  banco
    .prepare(
      `SELECT DISTINCT t.issue FROM execucao e JOIN ticket t ON t.id = e.ticket JOIN issue i ON i.id = t.issue
       WHERE ($projeto IS NULL OR i.projeto = $projeto) AND ($issue IS NULL OR i.id = $issue) ORDER BY t.issue`,
    )
    .all({ projeto: filtro.projeto ?? null, issue: filtro.issue ?? null })
    .map((l) => Number(l.issue));

/** A issue da sessão do pi `sessaoPi`, se alguma execução a usou. */
export function issueDaSessao(banco: DatabaseSync, sessaoPi: string): Id | undefined {
  const linha = banco
    .prepare("SELECT t.issue FROM execucao e JOIN ticket t ON t.id = e.ticket WHERE e.sessao_pi = ? LIMIT 1")
    .get(sessaoPi);
  return linha && Number(linha.issue);
}

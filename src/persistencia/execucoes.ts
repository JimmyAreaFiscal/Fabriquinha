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

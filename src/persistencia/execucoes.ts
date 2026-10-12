// Arquivos e dados de uma execução fora do agregado (F2 §2, F4 §6.1.2, §7): o diretório `<raiz>/execucoes/E-<n>/`, o
// `log` dele e o grupo de processos do pi.
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";

/** `<raiz>/execucoes/E-<n>`: `log`, `prompt.md` e `saida/` da execução. */
export const dirDaExecucao = (raiz: string, execucao: Id): string => join(raiz, "execucoes", `E-${String(execucao)}`);

/** Uma linha com horário no log da execução (`<dirDaExecucao>/log`). */
export const anotar = (log: string, texto: string): void => {
  appendFileSync(log, `${new Date().toISOString()} ${texto}\n`);
};

/** O log do serviço é o stderr, que o systemd guarda (F4 §2). */
export const noLog = (erro: unknown): void => {
  console.error(`${new Date().toISOString()} fabriquinha:`, erro);
};

/**
 * O arquivo JSONL que o pi grava em `<raiz>/sessoes/<instante>_<sessaoPi>.jsonl`, ou `undefined` se ainda não existe.
 * Mais de um arquivo para o mesmo ID é erro (F6 §3.1): não há como saber qual é a sessão.
 */
export function arquivoDaSessao(raiz: string, sessao: string): string | undefined {
  const dir = join(raiz, "sessoes");
  const achados = existsSync(dir) ? readdirSync(dir).filter((nome) => nome.endsWith(`_${sessao}.jsonl`)) : [];
  if (achados.length > 1) {
    throw new ErroDeRegra(
      `a sessão ${sessao} tem ${String(achados.length)} arquivos em ${dir}: ${achados.join(", ")}`,
      "deixe só o arquivo da sessão e apague as cópias",
    );
  }
  return achados[0] && join(dir, achados[0]);
}

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

/** A execução `id` com o ticket e o projeto dela, ou `undefined` se não existe: o agente do CLI (F7 §3.1). */
export function execucaoDoAgente(
  banco: DatabaseSync,
  id: string,
): { execucao: Id; ticket: Id; projeto: string; emAndamento: boolean } | undefined {
  const linha = banco
    .prepare(
      `SELECT e.id, e.ticket, e.resultado, i.projeto
       FROM execucao e JOIN ticket t ON t.id = e.ticket JOIN issue i ON i.id = t.issue WHERE e.id = ?`,
    )
    .get(id);
  return (
    linha && {
      execucao: Number(linha.id),
      ticket: Number(linha.ticket),
      projeto: String(linha.projeto),
      emAndamento: linha.resultado === "em_andamento",
    }
  );
}

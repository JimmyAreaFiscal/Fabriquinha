// Leituras das métricas de uma issue fora do agregado (F6 §5, §6.2): uso, comandos do Auditor, retrabalho e bugs.
import type { DatabaseSync } from "node:sqlite";
import type { Etapa, Fase, Id } from "../dominio/primitivos.ts";

/** O uso somado de uma etapa (ou das consultas, com `etapa` nula) num provedor + modelo. */
export interface UsoPorModelo {
  etapa: Etapa | null;
  provedor: string;
  modelo: string;
  chamadas: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  custo: number;
}

/** O uso das execuções da issue por etapa do ticket × provedor/modelo; as consultas (F4 §6.5) vêm com etapa nula. */
export const usoDaIssue = (banco: DatabaseSync, issue: Id): UsoPorModelo[] =>
  banco
    .prepare(
      `SELECT CASE e.modo WHEN 'consulta' THEN NULL ELSE t.etapa END AS etapa, u.provedor, u.modelo,
         SUM(u.chamadas) AS chamadas, SUM(u.input) AS input, SUM(u.output) AS output,
         SUM(u.cache_read) AS cacheRead, SUM(u.cache_write) AS cacheWrite, SUM(u.custo) AS custo
       FROM uso u JOIN execucao e ON e.id = u.execucao JOIN ticket t ON t.id = e.ticket
       WHERE t.issue = ? GROUP BY 1, 2, 3 ORDER BY 2, 3`,
    )
    .all(issue) as unknown as UsoPorModelo[];

/** Quantas vezes o Auditor aplicou cada comando na issue, por fase de antes do comando (F6 §5.1). */
export const comandosDoAuditor = (banco: DatabaseSync, issue: Id): { fase: Fase; nome: string; n: number }[] =>
  banco
    .prepare("SELECT fase, nome, COUNT(*) AS n FROM comando WHERE issue = ? AND ator = 'auditor' GROUP BY fase, nome")
    .all(issue) as unknown as { fase: Fase; nome: string; n: number }[];

/** M4 de um ticket (F6 §4.3). */
export interface RetrabalhoDoTicket {
  ticket: Id;
  linhasAdicionadas: number;
  linhasAlteradasDepois: number;
  linhasAlteradasPorHumanos: number;
}

/**
 * F6 §4.3: por ticket da issue com commit, as linhas que ele adicionou (binário não conta) e as que outro ticket ou
 * uma pessoa removeu ou reescreveu depois.
 */
export const retrabalhoDaIssue = (banco: DatabaseSync, issue: Id): RetrabalhoDoTicket[] =>
  banco
    .prepare(
      `SELECT c.ticket,
         (SELECT COALESCE(SUM(a.adicionadas), 0) FROM arquivo_commit a WHERE a.sha = c.sha) AS linhasAdicionadas,
         (SELECT COALESCE(SUM(r.linhas), 0) FROM retrabalho r WHERE r.ticket_origem = c.ticket) AS linhasAlteradasDepois,
         (SELECT COALESCE(SUM(r.linhas), 0) FROM retrabalho r WHERE r.ticket_origem = c.ticket AND r.ticket IS NULL)
           AS linhasAlteradasPorHumanos
       FROM commit_ticket c JOIN ticket t ON t.id = c.ticket WHERE t.issue = ? ORDER BY c.ticket`,
    )
    .all(issue) as unknown as RetrabalhoDoTicket[];

/**
 * F6 §5.3 (M6): issues `problema` do mesmo projeto, registradas depois que a issue foi concluída e já concluídas, que
 * alteraram arquivo que ela alterou. Nas renomeações, dos dois lados, contam os dois caminhos. Zero antes da conclusão.
 */
export const bugsEmArquivosRevisados = (banco: DatabaseSync, issue: Id): number =>
  Number(
    banco
      .prepare(
        `WITH arquivos (issue, caminho) AS (
           SELECT t.issue, a.caminho FROM arquivo_commit a JOIN commit_ticket c ON c.sha = a.sha
             JOIN ticket t ON t.id = c.ticket
           UNION SELECT t.issue, a.caminho_anterior FROM arquivo_commit a JOIN commit_ticket c ON c.sha = a.sha
             JOIN ticket t ON t.id = c.ticket WHERE a.caminho_anterior IS NOT NULL
         )
         SELECT COUNT(*) AS n FROM issue x JOIN issue y ON y.projeto = x.projeto
         WHERE x.id = ? AND y.tipo = 'problema' AND y.fase = 'concluida' AND y.criada_em > x.concluida_em
           AND EXISTS (SELECT 1 FROM arquivos ax JOIN arquivos ay ON ay.caminho = ax.caminho
                       WHERE ax.issue = x.id AND ay.issue = y.id)`,
      )
      .get(issue)?.n,
  );

// Leituras das métricas de uma issue fora do agregado (F6 §5, §6.2): uso, comandos do Auditor, retrabalho e bugs.
import type { DatabaseSync } from "node:sqlite";
import type { Decisao } from "../dominio/agregado.ts";
import type { Etapa, Fase, Id } from "../dominio/primitivos.ts";

/** Chamadas, tokens e custo somados de linhas de `uso`. */
export interface SomaDeUso {
  chamadas: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  custo: number;
}

/** O uso somado de um provedor + modelo. */
export interface UsoDoModelo extends SomaDeUso {
  provedor: string;
  modelo: string;
}

/** O uso somado de uma etapa (ou das consultas, com `etapa` nula) num provedor + modelo. */
export interface UsoPorModelo extends UsoDoModelo {
  etapa: Etapa | null;
}

const SOMAS_DE_USO = `SUM(u.chamadas) AS chamadas, SUM(u.input) AS input, SUM(u.output) AS output,
  SUM(u.cache_read) AS cacheRead, SUM(u.cache_write) AS cacheWrite, SUM(u.custo) AS custo`;

/** O uso das execuções da issue por etapa do ticket × provedor/modelo; as consultas (F4 §6.5) vêm com etapa nula. */
export const usoDaIssue = (banco: DatabaseSync, issue: Id): UsoPorModelo[] =>
  banco
    .prepare(
      `SELECT CASE e.modo WHEN 'consulta' THEN NULL ELSE t.etapa END AS etapa, u.provedor, u.modelo, ${SOMAS_DE_USO}
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

/** Um mês do fuso do serviço como o intervalo `[inicio, fim)` de instantes UTC, no formato gravado no banco. */
export interface Intervalo {
  mes: string;
  inicio: string;
  fim: string;
}

/** Os meses como tabela, a partir do parâmetro `$meses` (JSON de `Intervalo[]`). */
const MESES = `meses (mes, inicio, fim) AS (
  SELECT value ->> 'mes', value ->> 'inicio', value ->> 'fim' FROM json_each($meses))`;

/** Os dois parâmetros das leituras por mês; `projeto` nulo é todos os projetos. */
const porMes = (meses: readonly Intervalo[], projeto: string | null) => ({ meses: JSON.stringify(meses), projeto });

/** Uso, execuções, falhas e duração somados de um grupo de execuções `e` (F6 §5.6). */
export interface ApoioDeExecucoes extends SomaDeUso {
  execucoes: number;
  falhas: number;
  duracaoMs: number;
}

// TOTAL dá 0 sem linhas. A duração só soma as terminadas, e um relógio que volta não a deixa negativa.
const APOIO = `TOTAL(u.chamadas) AS chamadas, TOTAL(u.input) AS input, TOTAL(u.output) AS output,
  TOTAL(u.cacheRead) AS cacheRead, TOTAL(u.cacheWrite) AS cacheWrite, TOTAL(u.custo) AS custo,
  COUNT(*) AS execucoes, TOTAL(e.resultado = 'falha') AS falhas,
  TOTAL(MAX(0, ROUND((julianday(e.terminada_em) - julianday(e.iniciada_em)) * 86400000))) AS duracaoMs`;
const USO_DA_EXECUCAO = `LEFT JOIN (SELECT execucao, ${SOMAS_DE_USO} FROM uso u GROUP BY execucao) u
  ON u.execucao = e.id`;

/** F6 §5.7: o uso por mês × provedor/modelo, pelo mês em que a execução dona da linha começou, consultas incluídas. */
export const usoPorMes = (
  banco: DatabaseSync,
  meses: readonly Intervalo[],
  projeto: string | null,
): (UsoDoModelo & { mes: string })[] =>
  banco
    .prepare(
      `WITH ${MESES}
       SELECT m.mes, u.provedor, u.modelo, ${SOMAS_DE_USO}
       FROM meses m JOIN execucao e ON e.iniciada_em >= m.inicio AND e.iniciada_em < m.fim
         JOIN ticket t ON t.id = e.ticket JOIN issue i ON i.id = t.issue JOIN uso u ON u.execucao = e.id
       WHERE $projeto IS NULL OR i.projeto = $projeto
       GROUP BY 1, 2, 3 ORDER BY 2, 3`,
    )
    .all(porMes(meses, projeto)) as unknown as (UsoDoModelo & { mes: string })[];

/** F6 §5.7: o apoio por mês × etapa das execuções autônomas e interativas, pelo mês em que começaram. */
export const execucoesPorMes = (
  banco: DatabaseSync,
  meses: readonly Intervalo[],
  projeto: string | null,
): (ApoioDeExecucoes & { mes: string; etapa: Etapa })[] =>
  banco
    .prepare(
      `WITH ${MESES}
       SELECT m.mes, t.etapa, ${APOIO}
       FROM meses m JOIN execucao e ON e.iniciada_em >= m.inicio AND e.iniciada_em < m.fim
         JOIN ticket t ON t.id = e.ticket JOIN issue i ON i.id = t.issue ${USO_DA_EXECUCAO}
       WHERE e.modo <> 'consulta' AND ($projeto IS NULL OR i.projeto = $projeto)
       GROUP BY 1, 2`,
    )
    .all(porMes(meses, projeto)) as unknown as (ApoioDeExecucoes & { mes: string; etapa: Etapa })[];

/** Os fatos contados por mês (F6 §5.7); as reprovações vêm por gate, como `reprovacao_<gate>`. */
export type Fato =
  | "issuesRegistradas"
  | "issuesConcluidas"
  | "ticketsCriados"
  | "ticketsConcluidos"
  | "prsAbertos"
  | "prsMergeados"
  | `reprovacao_${Decisao["gate"]}`;

/**
 * F6 §5.7: quantos de cada fato caíram em cada mês e, para os PRs mergeados, a média e a quantidade das notas.
 * Tickets apagados (C8, C13, C15) não existem mais e não contam; o PR conta pela primeira `pr_aberto` da issue.
 * ponytail: varre issue, ticket, evidência e decisão inteiras a cada chamada; índices por data se passarem de
 * dezenas de milhares de linhas.
 */
export const fatosPorMes = (
  banco: DatabaseSync,
  meses: readonly Intervalo[],
  projeto: string | null,
): { mes: string; fato: Fato; n: number; notas: number; media: number | null }[] =>
  banco
    .prepare(
      `WITH ${MESES}, fatos (fato, em, nota, projeto) AS (
         SELECT 'issuesRegistradas', criada_em, NULL, projeto FROM issue
         UNION ALL SELECT 'issuesConcluidas', concluida_em, NULL, projeto FROM issue
         UNION ALL SELECT 'ticketsCriados', t.criado_em, NULL, i.projeto FROM ticket t JOIN issue i ON i.id = t.issue
         UNION ALL SELECT 'ticketsConcluidos', t.concluido_em, NULL, i.projeto
           FROM ticket t JOIN issue i ON i.id = t.issue
         UNION ALL SELECT 'prsAbertos', MIN(v.em), NULL, i.projeto
           FROM evidencia v JOIN ticket t ON t.id = v.ticket JOIN issue i ON i.id = t.issue
           WHERE v.tipo = 'pr_aberto' GROUP BY i.id
         UNION ALL SELECT 'prsMergeados', d.em, d.nota, i.projeto FROM decisao d JOIN issue i ON i.id = d.issue
           WHERE d.gate = 'pr' AND d.aprovado = 1
         UNION ALL SELECT 'reprovacao_' || d.gate, d.em, NULL, i.projeto FROM decisao d JOIN issue i ON i.id = d.issue
           WHERE d.aprovado = 0
       )
       SELECT m.mes, f.fato, COUNT(*) AS n, COUNT(f.nota) AS notas, AVG(f.nota) AS media
       FROM meses m JOIN fatos f ON f.em >= m.inicio AND f.em < m.fim
       WHERE $projeto IS NULL OR f.projeto = $projeto
       GROUP BY 1, 2`,
    )
    .all(porMes(meses, projeto)) as unknown as {
    mes: string;
    fato: Fato;
    n: number;
    notas: number;
    media: number | null;
  }[];

/** Uma issue com execução iniciada no período, com o apoio dessas execuções, consultas incluídas (F6 §5.8). */
export interface IssueNoPeriodo extends ApoioDeExecucoes {
  issue: Id;
  projeto: string;
  titulo: string | null;
  fase: Fase;
  reprovacoes: number;
  notaPR: number | null;
}

/**
 * F6 §5.8: as issues com execução iniciada em `[inicio, fim)`, com o apoio dessas execuções e as reprovações
 * decididas no período; `fase` e `notaPR` são os atuais.
 */
export const issuesNoPeriodo = (
  banco: DatabaseSync,
  periodo: Pick<Intervalo, "inicio" | "fim">,
  projeto: string | null,
): IssueNoPeriodo[] =>
  banco
    .prepare(
      `SELECT i.id AS issue, i.projeto, i.titulo, i.fase, ${APOIO},
         (SELECT COUNT(*) FROM decisao d WHERE d.issue = i.id AND d.aprovado = 0 AND d.em >= $inicio AND d.em < $fim)
           AS reprovacoes,
         (SELECT d.nota FROM decisao d WHERE d.issue = i.id AND d.gate = 'pr' AND d.aprovado = 1) AS notaPR
       FROM execucao e JOIN ticket t ON t.id = e.ticket JOIN issue i ON i.id = t.issue ${USO_DA_EXECUCAO}
       WHERE e.iniciada_em >= $inicio AND e.iniciada_em < $fim AND ($projeto IS NULL OR i.projeto = $projeto)
       GROUP BY i.id ORDER BY i.id`,
    )
    .all({ inicio: periodo.inicio, fim: periodo.fim, projeto }) as unknown as IssueNoPeriodo[];

// Leituras de só leitura para as métricas do SDLC por demandas (comparacao-sdlc-implementacao.md §8).
import type { DatabaseSync } from "node:sqlite";
import { Plano } from "../dominio/demanda.ts";

export const demandaExiste = (banco: DatabaseSync, demandaId: string): boolean =>
  banco.prepare("SELECT 1 FROM demanda WHERE id = ?").get(demandaId) !== undefined;

export const rodadaExiste = (banco: DatabaseSync, demandaId: string, rodadaId: number): boolean =>
  banco.prepare("SELECT 1 FROM rodada WHERE demanda_id = ? AND rodada_id = ?").get(demandaId, rodadaId) !== undefined;

/** Caminhos que o plano original (evidência `plano` do ticket `planejar`) previu para a rodada; `undefined` sem plano. */
export function caminhosPlanejadosDaRodada(
  banco: DatabaseSync,
  demandaId: string,
  rodadaId: number,
): string[] | undefined {
  const l = banco
    .prepare(
      `SELECT e.dados FROM evidencia_demanda e
       JOIN ticket_demanda t ON t.demanda_id = e.demanda_id AND t.ticket_id = e.ticket_id
       WHERE e.demanda_id = ? AND e.tipo = 'plano' AND t.etapa = 'planejar'`,
    )
    .get(demandaId) as { dados: string } | undefined;
  if (!l) return undefined;
  const plano = Plano.parse(JSON.parse(l.dados));
  return plano.tickets.filter((t) => t.rodada_id === rodadaId).flatMap((t) => t.caminhos);
}

export interface ArquivoDaRodada {
  caminho: string;
  caminhoAnterior: string | null;
}

/** Arquivos dos commits dos tickets da rodada (inclusive corretivos); `commits` conta os commits encontrados. */
export function arquivosDaRodada(
  banco: DatabaseSync,
  demandaId: string,
  rodadaId: number,
): { commits: number; arquivos: ArquivoDaRodada[] } {
  const commits = banco
    .prepare(
      `SELECT COUNT(*) AS n FROM commit_ticket_demanda c
       JOIN ticket_demanda t ON t.demanda_id = c.demanda_id AND t.ticket_id = c.ticket_id
       WHERE c.demanda_id = ? AND t.rodada_id = ?`,
    )
    .get(demandaId, rodadaId) as { n: number };
  const arquivos = banco
    .prepare(
      `SELECT a.caminho, a.caminho_anterior FROM arquivo_commit_demanda a
       JOIN commit_ticket_demanda c ON c.sha = a.sha
       JOIN ticket_demanda t ON t.demanda_id = c.demanda_id AND t.ticket_id = c.ticket_id
       WHERE c.demanda_id = ? AND t.rodada_id = ? ORDER BY a.rowid`,
    )
    .all(demandaId, rodadaId)
    .map((l) => ({ caminho: l.caminho as string, caminhoAnterior: l.caminho_anterior as string | null }));
  return { commits: commits.n, arquivos };
}

/** Dono de uma linha de métrica: a etapa do ticket e a rodada dele (`null` em ticket de demanda). */
export interface DonoDaLinha {
  etapa: string;
  rodadaId: number | null;
}

export interface UsoDaExecucao extends DonoDaLinha {
  provedor: string;
  modelo: string;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  /** `null` = custo desconhecido, nunca 0. */
  custo: number | null;
}

export interface ExecucaoDoTicket extends DonoDaLinha {
  falha: boolean;
}

export interface TicketDaDemanda extends DonoDaLinha {
  devolucoes: number;
}

export interface DecisaoDoTicket extends DonoDaLinha {
  recusada: boolean;
  nota: number | null;
}

const DONO = "t.etapa AS etapa, t.rodada_id AS rodada_id";
const rodadaDe = (l: Record<string, unknown>) => (l.rodada_id === null ? null : Number(l.rodada_id));
const NO_TICKET = "JOIN ticket_demanda t ON t.demanda_id = s.demanda_id AND t.ticket_id = s.ticket_id";

/** Uma linha por execução e modelo: cada linha de `uso_modelo_execucao` vale uma vez, retomada não a repete. */
export const usoDaDemanda = (banco: DatabaseSync, demandaId: string): UsoDaExecucao[] =>
  banco
    .prepare(
      `SELECT ${DONO}, u.modelo_provedor, u.modelo_nome, u.tokens_entrada, u.tokens_saida,
         u.tokens_cache_leitura, u.tokens_cache_escrita, u.custo
       FROM uso_modelo_execucao u
       JOIN execucao_sessao e ON e.id = u.execucao_id
       JOIN sessao s ON s.id = e.sessao_id ${NO_TICKET}
       WHERE s.demanda_id = ? ORDER BY u.rowid`,
    )
    .all(demandaId)
    .map((l) => ({
      etapa: l.etapa as string,
      rodadaId: rodadaDe(l),
      provedor: l.modelo_provedor as string,
      modelo: l.modelo_nome as string,
      entrada: Number(l.tokens_entrada),
      saida: Number(l.tokens_saida),
      cacheLeitura: Number(l.tokens_cache_leitura),
      cacheEscrita: Number(l.tokens_cache_escrita),
      custo: l.custo === null ? null : Number(l.custo),
    }));

export const execucoesDaDemanda = (banco: DatabaseSync, demandaId: string): ExecucaoDoTicket[] =>
  banco
    .prepare(
      `SELECT ${DONO}, e.falha FROM execucao_sessao e
       JOIN sessao s ON s.id = e.sessao_id ${NO_TICKET}
       WHERE s.demanda_id = ?`,
    )
    .all(demandaId)
    .map((l) => ({ etapa: l.etapa as string, rodadaId: rodadaDe(l), falha: l.falha === 1 }));

export const ticketsDaDemanda = (banco: DatabaseSync, demandaId: string): TicketDaDemanda[] =>
  banco
    .prepare(`SELECT ${DONO}, t.devolucoes FROM ticket_demanda t WHERE t.demanda_id = ? ORDER BY t.ticket_id`)
    .all(demandaId)
    .map((l) => ({ etapa: l.etapa as string, rodadaId: rodadaDe(l), devolucoes: Number(l.devolucoes) }));

export const decisoesDaDemanda = (banco: DatabaseSync, demandaId: string): DecisaoDoTicket[] =>
  banco
    .prepare(
      `SELECT ${DONO}, d.resultado, d.nota FROM decisao_ticket d
       JOIN ticket_demanda t ON t.demanda_id = d.demanda_id AND t.ticket_id = d.ticket_id
       WHERE d.demanda_id = ?`,
    )
    .all(demandaId)
    .map((l) => ({
      etapa: l.etapa as string,
      rodadaId: rodadaDe(l),
      recusada: l.resultado === "recusado",
      nota: l.nota === null ? null : Number(l.nota),
    }));

export const rodadasDaDemanda = (banco: DatabaseSync, demandaId: string): number[] =>
  banco
    .prepare("SELECT rodada_id FROM rodada WHERE demanda_id = ? ORDER BY rodada_id")
    .all(demandaId)
    .map((l) => Number(l.rodada_id));

export interface LinhaExterna {
  ferramenta: string;
  sessao: string;
  /** `null` = desconhecido. */
  custo: number | null;
}

/** Linhas de `custos_realizados` da demanda (evidência sem rodada nem ticket) das sessões externas cuja dona é a demanda; evidência malformada não conta (o banco já garante JSON válido). */
export const linhasExternasDaDemanda = (banco: DatabaseSync, demandaId: string): LinhaExterna[] =>
  banco
    .prepare(
      `SELECT x.ferramenta, x.sessao, json_extract(l.value, '$.custo') AS custo
       FROM evidencia_demanda e, json_each(e.dados, '$.sessoes') s, json_each(s.value, '$.linhas') l
       JOIN sessao_externa_demanda x ON x.demanda_id = e.demanda_id
         AND x.ferramenta = json_extract(s.value, '$.ferramenta') AND x.sessao = json_extract(s.value, '$.sessao')
       WHERE e.demanda_id = ? AND e.tipo = 'custos_realizados' AND e.rodada_id IS NULL AND e.ticket_id IS NULL
         AND json_type(e.dados, '$.sessoes') = 'array'
         AND json_type(s.value, '$.linhas') = 'array'`,
    )
    .all(demandaId)
    .map((l) => ({
      ferramenta: l.ferramenta as string,
      sessao: l.sessao as string,
      custo: typeof l.custo === "number" ? l.custo : null,
    }));

export const projetoExiste = (banco: DatabaseSync, nome: string): boolean =>
  banco.prepare("SELECT 1 FROM projeto WHERE nome = ?").get(nome) !== undefined;

export const demandasDoProjeto = (banco: DatabaseSync, projeto: string): string[] =>
  banco
    .prepare("SELECT id FROM demanda WHERE projeto = ? ORDER BY id")
    .all(projeto)
    .map((l) => l.id as string);

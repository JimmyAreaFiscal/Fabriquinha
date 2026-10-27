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

// Commit, arquivos e retrabalho do ticket da demanda (comparacao-sdlc-implementacao.md §8, §10.1), ao lado do legado.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../dominio/erros.ts";
import { escrever } from "./banco.ts";
import type { ArquivoCommit, Commit } from "./commits.ts";

const donoDe = (banco: DatabaseSync, sha: string) =>
  banco.prepare("SELECT demanda_id, ticket_id FROM commit_ticket_demanda WHERE sha = ?").get(sha);

/** O ticket da demanda que registrou o commit `sha`, se algum registrou. */
export function donoDoCommitDemanda(
  banco: DatabaseSync,
  sha: string,
): { demandaId: string; ticketId: number } | undefined {
  const d = donoDe(banco, sha);
  return d && { demandaId: d.demanda_id as string, ticketId: d.ticket_id as number };
}

/** Algum ticket de demanda registrou o commit `sha`. */
export const commitRegistradoDemanda = (banco: DatabaseSync, sha: string): boolean => donoDe(banco, sha) !== undefined;

/** Grava o commit e os arquivos do ticket; o mesmo sha no mesmo ticket não escreve nada. */
export function gravarCommitDemanda(
  banco: DatabaseSync,
  demandaId: string,
  ticketId: number,
  { sha, mensagem, em, arquivos }: Commit,
): void {
  escrever(banco, () => {
    const dono = donoDe(banco, sha);
    if (dono?.demanda_id === demandaId && dono.ticket_id === ticketId) return;
    if (dono) throw new ErroDeRegra(`o commit ${sha} já é de outro ticket`, "um commit pertence a um só ticket");
    if (
      banco
        .prepare("SELECT 1 FROM commit_ticket_demanda WHERE demanda_id = ? AND ticket_id = ?")
        .get(demandaId, ticketId)
    )
      throw new ErroDeRegra(`o ticket ${String(ticketId)} de ${demandaId} já tem commit`, "um ticket tem um só commit");
    for (const a of arquivos) {
      if ((a.status === "R") !== (a.caminhoAnterior !== undefined))
        throw new ErroDeRegra(
          `o arquivo ${a.caminho} tem status ${a.status} e caminho anterior inconsistentes`,
          "só a renomeação (R) traz caminho anterior",
        );
    }
    try {
      banco
        .prepare("INSERT INTO commit_ticket_demanda (sha, demanda_id, ticket_id, mensagem, em) VALUES (?, ?, ?, ?, ?)")
        .run(sha, demandaId, ticketId, mensagem, em);
    } catch {
      throw new ErroDeRegra(
        `o ticket ${String(ticketId)} não existe na demanda ${demandaId}`,
        "confira a demanda e o ticket",
      );
    }
    const insere = banco.prepare(
      `INSERT INTO arquivo_commit_demanda (sha, caminho, caminho_anterior, status, adicionadas, removidas)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const a of arquivos)
      insere.run(sha, a.caminho, a.caminhoAnterior ?? null, a.status, a.adicionadas, a.removidas);
  });
}

/** O commit do ticket com os arquivos, se ele tem. */
export function commitDoTicketDemanda(banco: DatabaseSync, demandaId: string, ticketId: number): Commit | undefined {
  const c = banco
    .prepare("SELECT sha, mensagem, em FROM commit_ticket_demanda WHERE demanda_id = ? AND ticket_id = ?")
    .get(demandaId, ticketId) as { sha: string; mensagem: string; em: string } | undefined;
  if (!c) return undefined;
  const arquivos = banco
    .prepare(
      "SELECT caminho, caminho_anterior, status, adicionadas, removidas FROM arquivo_commit_demanda WHERE sha = ? ORDER BY rowid",
    )
    .all(c.sha)
    .map((l): ArquivoCommit => {
      const { caminho_anterior, ...resto } = l;
      return {
        ...(resto as unknown as ArquivoCommit),
        ...(caminho_anterior === null ? {} : { caminhoAnterior: caminho_anterior as string }),
      };
    });
  return { ...c, arquivos };
}

/** As linhas reescritas por ticket de origem, agrupadas pela demanda dele (origem → quantidade). */
export type LinhasPorDemanda = Map<string, Map<number, number>>;

const inserirRetrabalho = (
  banco: DatabaseSync,
  sha: string,
  alterador: { demandaId: string; ticketId: number } | null,
  autor: string | null,
  linhas: LinhasPorDemanda,
) => {
  const insere = banco.prepare(
    `INSERT OR REPLACE INTO retrabalho_demanda (commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    for (const [demandaId, porTicket] of linhas)
      for (const [origem, n] of porTicket)
        insere.run(sha, demandaId, alterador?.ticketId ?? null, autor, origem, n, alterador?.demandaId ?? null);
  } catch {
    throw new ErroDeRegra(`retrabalho inválido no commit ${sha}`, "os tickets precisam existir na demanda");
  }
};

/** Troca as linhas em que o ticket é o alterador pelas de `linhas`. */
export function gravarRetrabalhoDoTicket(
  banco: DatabaseSync,
  demandaId: string,
  ticketId: number,
  sha: string,
  linhas: LinhasPorDemanda,
): void {
  escrever(banco, () => {
    banco
      .prepare("DELETE FROM retrabalho_demanda WHERE alterador_demanda_id = ? AND ticket_id = ?")
      .run(demandaId, ticketId);
    inserirRetrabalho(banco, sha, { demandaId, ticketId }, null, linhas);
  });
}

/** Grava as linhas de um commit humano de `autor`. */
export function gravarRetrabalhoExterno(
  banco: DatabaseSync,
  sha: string,
  autor: string,
  linhas: LinhasPorDemanda,
): void {
  escrever(banco, () => {
    inserirRetrabalho(banco, sha, null, autor, linhas);
  });
}

export interface RetrabalhoDoTicket {
  commitAlterador: string;
  ticketAlterador?: number;
  demandaAlteradora?: string;
  autor?: string;
  linhas: number;
}

/** Os commits que reescreveram linhas do ticket de origem. */
export const retrabalhoDoTicket = (banco: DatabaseSync, demandaId: string, origem: number): RetrabalhoDoTicket[] =>
  banco
    .prepare(
      `SELECT commit_alterador, ticket_id, alterador_demanda_id, autor, linhas FROM retrabalho_demanda
       WHERE demanda_id = ? AND ticket_origem_id = ? ORDER BY rowid`,
    )
    .all(demandaId, origem)
    .map((l) => ({
      commitAlterador: l.commit_alterador as string,
      ...(l.ticket_id === null ? { autor: l.autor as string } : { ticketAlterador: l.ticket_id as number }),
      ...(l.alterador_demanda_id === null || l.alterador_demanda_id === demandaId
        ? {}
        : { demandaAlteradora: l.alterador_demanda_id as string }),
      linhas: l.linhas as number,
    }));

// Commit, arquivos e commits posteriores do ticket da demanda (comparacao-sdlc-implementacao.md §8, §10.1).
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { escrever, instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";
import type { ArquivoCommit, Commit } from "../nucleo/commits.ts";

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

/** O commit de um ticket lido em lote, com as linhas que ele adicionou e as que uma pessoa alterou depois, na base. */
interface AlteracoesDoCommit {
  sha: string;
  demanda_id: string;
  ticket_id: number;
  em: string;
  linhasAdicionadas: number;
  linhasAlteradasPorHumanos: number;
}

/** Os commits dos tickets das demandas, em lote, com as alterações de cada um; com `periodo`, os feitos em `[inicio, fim)`. */
export const alteracoesDosCommitsEmLote = (
  banco: DatabaseSync,
  filtro: { demandas: readonly string[]; periodo?: { inicio?: string; fim?: string } },
): AlteracoesDoCommit[] =>
  instrucaoPreparada(
    banco,
    `SELECT c.sha, c.demanda_id, c.ticket_id, c.em,
         (SELECT COALESCE(SUM(a.adicionadas), 0) FROM arquivo_commit_demanda a WHERE a.sha = c.sha) AS adicionadas,
         (SELECT COALESCE(SUM(r.linhas), 0) FROM commit_humano_posterior r
           WHERE r.demanda_id = c.demanda_id AND r.ticket_origem_id = c.ticket_id AND r.ticket_id IS NULL) AS por_humanos
       FROM commit_ticket_demanda c
       WHERE c.demanda_id IN (SELECT value FROM json_each($demandas))
         AND ($inicio IS NULL OR c.em >= $inicio) AND ($fim IS NULL OR c.em < $fim)
       ORDER BY c.rowid`,
  )
    .all({
      demandas: JSON.stringify(filtro.demandas),
      inicio: filtro.periodo?.inicio ?? null,
      fim: filtro.periodo?.fim ?? null,
    })
    .map((linha) => ({
      sha: String(linha.sha),
      demanda_id: String(linha.demanda_id),
      ticket_id: Number(linha.ticket_id),
      em: String(linha.em),
      linhasAdicionadas: Number(linha.adicionadas),
      linhasAlteradasPorHumanos: Number(linha.por_humanos),
    }));

/** Os commits dos tickets das demandas, em lote e sem os arquivos, na ordem em que foram gravados. */
export const commitsDosTicketsEmLote = (
  banco: DatabaseSync,
  demandas: readonly string[],
): { sha: string; demanda_id: string; ticket_id: number; em: string }[] =>
  instrucaoPreparada(
    banco,
    `SELECT sha, demanda_id, ticket_id, em FROM commit_ticket_demanda
       WHERE demanda_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
  )
    .all(JSON.stringify(demandas))
    .map((linha) => ({
      sha: String(linha.sha),
      demanda_id: String(linha.demanda_id),
      ticket_id: Number(linha.ticket_id),
      em: String(linha.em),
    }));

/** Os arquivos dos commits `shas`, em lote, na ordem em que foram gravados; o caminho anterior só vem na renomeação. */
export const arquivosDosCommits = (
  banco: DatabaseSync,
  shas: readonly string[],
): { sha: string; caminho: string; caminhoAnterior: string | null }[] =>
  instrucaoPreparada(
    banco,
    `SELECT sha, caminho, caminho_anterior FROM arquivo_commit_demanda
       WHERE sha IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
  )
    .all(JSON.stringify(shas))
    .map((linha) => ({
      sha: String(linha.sha),
      caminho: String(linha.caminho),
      caminhoAnterior: linha.caminho_anterior === null ? null : String(linha.caminho_anterior),
    }));

/** As linhas reescritas por ticket de origem, agrupadas pela demanda dele (origem → quantidade). */
export type LinhasPorDemanda = Map<string, Map<number, number>>;

const inserirCommitsPosteriores = (
  banco: DatabaseSync,
  sha: string,
  alterador: { demandaId: string; ticketId: number } | null,
  autor: string | null,
  linhas: LinhasPorDemanda,
) => {
  const insere = banco.prepare(
    `INSERT OR REPLACE INTO commit_humano_posterior (commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    for (const [demandaId, porTicket] of linhas)
      for (const [origem, n] of porTicket)
        insere.run(sha, demandaId, alterador?.ticketId ?? null, autor, origem, n, alterador?.demandaId ?? null);
  } catch {
    throw new ErroDeRegra(`commits posteriores inválidos no commit ${sha}`, "os tickets precisam existir na demanda");
  }
};

/** Troca as linhas em que o ticket é o alterador pelas de `linhas`. */
export function gravarCommitsPosterioresDoTicket(
  banco: DatabaseSync,
  demandaId: string,
  ticketId: number,
  sha: string,
  linhas: LinhasPorDemanda,
): void {
  escrever(banco, () => {
    banco
      .prepare("DELETE FROM commit_humano_posterior WHERE alterador_demanda_id = ? AND ticket_id = ?")
      .run(demandaId, ticketId);
    inserirCommitsPosteriores(banco, sha, { demandaId, ticketId }, null, linhas);
  });
}

/** Grava as linhas de um commit humano de `autor`. */
export function gravarCommitHumanoPosterior(
  banco: DatabaseSync,
  sha: string,
  autor: string,
  linhas: LinhasPorDemanda,
): void {
  escrever(banco, () => {
    inserirCommitsPosteriores(banco, sha, null, autor, linhas);
  });
}

/** Na remoção do projeto: os commits dos tickets das `demandas`, os arquivos deles e os commits humanos posteriores. */
export function apagarCommitsDasDemandas(banco: DatabaseSync, demandas: readonly string[]): void {
  const dasDemandas = { demandas: JSON.stringify(demandas) };
  const doLote = "(SELECT value FROM json_each($demandas))";
  banco
    .prepare(`DELETE FROM commit_humano_posterior WHERE demanda_id IN ${doLote} OR alterador_demanda_id IN ${doLote}`)
    .run(dasDemandas);
  banco
    .prepare(
      `DELETE FROM arquivo_commit_demanda WHERE sha IN (SELECT sha FROM commit_ticket_demanda WHERE demanda_id IN ${doLote})`,
    )
    .run(dasDemandas);
  banco.prepare(`DELETE FROM commit_ticket_demanda WHERE demanda_id IN ${doLote}`).run(dasDemandas);
}

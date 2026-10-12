// O commit de cada ticket de desenvolvimento e os arquivos dele (F5 §4, §7), fora do agregado: o C7 só pergunta se
// o ticket tem commit (`Contexto.temCommit`), e o F6 consulta os arquivos por caminho.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Id } from "../dominio/primitivos.ts";

/** Adicionado, modificado, removido ou renomeado (F5 §7). */
export const StatusArquivo = z.enum(["A", "M", "D", "R"]);
export type StatusArquivo = z.infer<typeof StatusArquivo>;

export interface ArquivoCommit {
  caminho: string;
  /** Só em renomeação. */
  caminhoAnterior?: string;
  status: StatusArquivo;
  /** `null` em arquivo binário. */
  adicionadas: number | null;
  removidas: number | null;
}

export interface Commit {
  sha: string;
  mensagem: string;
  em: string;
  arquivos: ArquivoCommit[];
}

/** Grava o commit do ticket e os arquivos. Só dentro da transação de C7 (F5 §4, passo 4). */
export function gravarCommit(banco: DatabaseSync, ticket: Id, { sha, mensagem, em, arquivos }: Commit): void {
  banco
    .prepare("INSERT INTO commit_ticket (sha, ticket, mensagem, em) VALUES (?, ?, ?, ?)")
    .run(sha, ticket, mensagem, em);
  const arquivo = banco.prepare(
    `INSERT INTO arquivo_commit (sha, caminho, caminho_anterior, status, adicionadas, removidas)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const a of arquivos) {
    arquivo.run(sha, a.caminho, a.caminhoAnterior ?? null, a.status, a.adicionadas, a.removidas);
  }
}

/** O ticket tem commit registrado (F1 §5.1, C7 do desenvolvimento). */
export const temCommit = (banco: DatabaseSync, ticket: Id): boolean =>
  banco.prepare("SELECT 1 FROM commit_ticket WHERE ticket = ?").get(ticket) !== undefined;

/** Algum ticket registrou o commit `sha`. */
export const commitRegistrado = (banco: DatabaseSync, sha: string): boolean =>
  banco.prepare("SELECT 1 FROM commit_ticket WHERE sha = ?").get(sha) !== undefined;

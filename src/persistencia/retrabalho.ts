// Gravação e leitura do retrabalho e do cursor da varredura de commits humanos (F6 §4, §7).
import type { DatabaseSync } from "node:sqlite";
import type { Id } from "../dominio/primitivos.ts";
import { escrever } from "./banco.ts";
import { gravarRetrabalhoExterno, type LinhasPorDemanda } from "./commits_demanda.ts";

/** As linhas que um commit humano da base reescreveu, por ticket de origem (F6 §4.4). */
export interface CommitHumano {
  sha: string;
  autor: string;
  linhas: LinhasPorDemanda;
}

/**
 * `INSERT OR REPLACE`: a base que volta a um ponto anterior e depois traz de novo os mesmos commits não trava a
 * varredura com chave repetida.
 */
const inserir = (banco: DatabaseSync) =>
  banco.prepare(
    `INSERT OR REPLACE INTO retrabalho (commit_alterador, ticket, autor, ticket_origem, linhas) VALUES (?, ?, ?, ?, ?)`,
  );

/** F6 §4.2, passo 4: numa transação, troca as linhas em que o ticket é o alterador pelas de `linhas`. */
export function gravarRetrabalho(banco: DatabaseSync, ticket: Id, sha: string, linhas: Map<Id, number>): void {
  escrever(banco, () => {
    banco.prepare("DELETE FROM retrabalho WHERE ticket = ?").run(ticket);
    const linha = inserir(banco);
    for (const [origem, n] of linhas) linha.run(sha, ticket, null, origem, n);
  });
}

/** O último `sha` da base que a varredura do projeto viu, se ela já rodou. */
export const cursorDaBase = (banco: DatabaseSync, projeto: string): string | undefined =>
  (
    banco.prepare("SELECT ultimo_sha FROM varredura_base WHERE projeto = ?").get(projeto) as
      { ultimo_sha: string } | undefined
  )?.ultimo_sha;

/** F6 §4.4, passos 4 e 5: as linhas dos commits humanos e o cursor novo, na mesma transação. */
export function gravarVarredura(banco: DatabaseSync, projeto: string, cursor: string, humanos: CommitHumano[]): void {
  escrever(banco, () => {
    for (const h of humanos) gravarRetrabalhoExterno(banco, h.sha, h.autor, h.linhas);
    banco
      .prepare(
        `INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES (?, ?, ?)
         ON CONFLICT (projeto) DO UPDATE SET ultimo_sha = excluded.ultimo_sha, em = excluded.em`,
      )
      .run(projeto, cursor, new Date().toISOString());
  });
}

/** F4 §4, passo 1: os projetos sem varredura ou cuja última varredura tem mais de 24 horas, em ordem de nome. */
export const projetosAVarrer = (banco: DatabaseSync, agora = new Date()): string[] =>
  banco
    .prepare(
      `SELECT p.nome FROM projeto p LEFT JOIN varredura_base v ON v.projeto = p.nome
       WHERE v.em IS NULL OR v.em < ? ORDER BY p.nome`,
    )
    .all(new Date(agora.getTime() - 24 * 60 * 60_000).toISOString())
    .map((l) => String(l.nome));

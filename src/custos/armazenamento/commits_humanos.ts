// Os commits humanos posteriores da base e o cursor da varredura deles (F6 §4, §7).
import type { DatabaseSync } from "node:sqlite";
import { instanteAntes, type Relogio, relogioDoSistema } from "../../compartilhado/nucleo/relogio.ts";
import { escrever } from "../../compartilhado/armazenamento/banco.ts";
import { gravarCommitHumanoPosterior, type LinhasPorDemanda } from "../../sdlc/armazenamento/commits_demanda.ts";

/** As linhas que um commit humano posterior da base reescreveu, por ticket de origem (F6 §4.4). */
export interface CommitHumano {
  sha: string;
  autor: string;
  linhas: LinhasPorDemanda;
}

/** O último `sha` da base que a varredura do projeto viu, se ela já rodou. */
export const cursorDaBase = (banco: DatabaseSync, projeto: string): string | undefined =>
  (
    banco.prepare("SELECT ultimo_sha FROM varredura_base WHERE projeto = ?").get(projeto) as
      { ultimo_sha: string } | undefined
  )?.ultimo_sha;

/** F6 §4.4, passos 4 e 5: as linhas dos commits humanos e o cursor novo, na mesma transação. */
export function gravarVarredura(
  banco: DatabaseSync,
  projeto: string,
  cursor: string,
  humanos: CommitHumano[],
  relogio: Relogio = relogioDoSistema,
): void {
  escrever(banco, () => {
    for (const h of humanos) gravarCommitHumanoPosterior(banco, h.sha, h.autor, h.linhas);
    banco
      .prepare(
        `INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES (?, ?, ?)
         ON CONFLICT (projeto) DO UPDATE SET ultimo_sha = excluded.ultimo_sha, em = excluded.em`,
      )
      .run(projeto, cursor, relogio.agora());
  });
}

/** F4 §4, passo 1: os projetos sem varredura ou cuja última varredura tem mais de 24 horas, em ordem de nome. */
export const projetosAVarrer = (banco: DatabaseSync, relogio: Relogio = relogioDoSistema): string[] =>
  banco
    .prepare(
      `SELECT p.nome FROM projeto p LEFT JOIN varredura_base v ON v.projeto = p.nome
       WHERE v.em IS NULL OR v.em < ? ORDER BY p.nome`,
    )
    .all(instanteAntes(relogio.agora(), 24 * 60 * 60_000))
    .map((l) => String(l.nome));

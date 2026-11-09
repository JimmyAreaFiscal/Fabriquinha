// O Uso declarado (D10): o consumo de uma sessão de ferramenta externa, informado pelo produtor, uma linha por
// (ferramenta, sessao). A sessão repetida em outra demanda é contada uma vez só, na demanda que a informou primeiro.
import type { DatabaseSync } from "node:sqlite";
import type { LinhaDeUso } from "../nucleo/uso.ts";

export interface UsoDeclarado {
  ferramenta: string;
  sessao: string;
  demanda_id: string;
  linhas: LinhaDeUso[];
}

/**
 * Grava o Uso declarado, idempotente por (ferramenta, sessao): a mesma demanda informando de novo troca as linhas.
 * A demanda dona também fica em `trabalho_nao_gerenciado`.
 * Devolve a demanda dona da sessão; se não for `uso.demanda_id`, a sessão já constava nela e nada foi gravado.
 */
export function gravarUsoDeclarado(banco: DatabaseSync, uso: UsoDeclarado): { demandaDona: string } {
  banco
    .prepare(
      `INSERT INTO uso_declarado (ferramenta, sessao, demanda_id, linhas) VALUES (?, ?, ?, ?)
       ON CONFLICT (ferramenta, sessao) DO UPDATE SET linhas = excluded.linhas WHERE demanda_id = excluded.demanda_id`,
    )
    .run(uso.ferramenta, uso.sessao, uso.demanda_id, JSON.stringify(uso.linhas));
  const dona = banco
    .prepare("SELECT demanda_id FROM uso_declarado WHERE ferramenta = ? AND sessao = ?")
    .get(uso.ferramenta, uso.sessao);
  const demandaDona = String(dona?.demanda_id);
  if (demandaDona === uso.demanda_id) {
    banco
      .prepare("INSERT OR IGNORE INTO trabalho_nao_gerenciado (ferramenta, sessao, demanda_id) VALUES (?, ?, ?)")
      .run(uso.ferramenta, uso.sessao, uso.demanda_id);
  }
  return { demandaDona };
}

/** O Uso declarado das sessões cuja dona é a demanda, na ordem em que foram gravadas. */
export function lerUsoDeclarado(banco: DatabaseSync, demandaId: string): UsoDeclarado[] {
  return banco
    .prepare("SELECT ferramenta, sessao, demanda_id, linhas FROM uso_declarado WHERE demanda_id = ? ORDER BY rowid")
    .all(demandaId)
    .map((l) => ({
      ferramenta: String(l.ferramenta),
      sessao: String(l.sessao),
      demanda_id: String(l.demanda_id),
      linhas: JSON.parse(String(l.linhas)) as LinhaDeUso[],
    }));
}

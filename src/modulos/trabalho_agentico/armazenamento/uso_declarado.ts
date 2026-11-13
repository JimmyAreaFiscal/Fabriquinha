// O Uso declarado (D10): o consumo de uma sessão de ferramenta externa, informado pelo produtor, uma linha por
// (ferramenta, sessao). A sessão repetida em outra demanda é contada uma vez só, na demanda que a informou primeiro.
import type { DatabaseSync } from "node:sqlite";
import type { LinhaDeUso } from "../../sessoes/publico.ts";

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

/**
 * O Uso declarado das sessões cujo mês é o do registro da demanda dona (a sessão externa não grava data própria), no
 * período `[inicio, fim)`, de um projeto ou de todos (`projeto` `null`).
 * shortcut: o mês é o do registro da demanda; gravar a data da declaração em `uso_declarado` se isso distorcer a série.
 */
export function usoDeclaradoNoPeriodo(
  banco: DatabaseSync,
  recorte: { inicio: string; fim: string; projeto: string | null },
): { demanda: string; projeto: string; titulo: string; estado: string; em: string; linhas: LinhaDeUso[] }[] {
  return banco
    .prepare(
      `SELECT COALESCE(h.criada_em, (SELECT MIN(e.em) FROM evidencia_demanda e WHERE e.demanda_id = d.id),
         d.estado_alterado_em) AS em, u.demanda_id, d.projeto, d.titulo, d.estado, u.linhas
       FROM uso_declarado u JOIN demanda d ON d.id = u.demanda_id LEFT JOIN demanda_historico h ON h.demanda_id = d.id
       WHERE em >= $inicio AND em < $fim AND ($projeto IS NULL OR d.projeto = $projeto) ORDER BY u.rowid`,
    )
    .all(recorte)
    .map((l) => ({
      demanda: String(l.demanda_id),
      projeto: String(l.projeto),
      titulo: String(l.titulo),
      estado: String(l.estado),
      em: String(l.em),
      linhas: JSON.parse(String(l.linhas)) as LinhaDeUso[],
    }));
}

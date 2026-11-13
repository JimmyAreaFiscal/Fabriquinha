// provisório: remover no ticket 22. O Uso declarado (D10) mudou para src/modulos/sessoes/metricas_de_execucao/, pela
// fachada; aqui fica a leitura por período, que junta o Uso às tabelas das Demandas e da Evidência e é do ticket 17
// (Métricas de Qualidade: o recorte pelo registro da demanda passa a vir da fachada de Demandas).
import type { DatabaseSync } from "node:sqlite";
import type { LinhaDeUso } from "../../sessoes/publico.ts";

export { gravarUsoDeclarado, lerUsoDeclarado, type UsoDeclarado } from "../../sessoes/publico.ts";

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

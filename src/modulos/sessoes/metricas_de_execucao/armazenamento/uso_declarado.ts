// O Uso declarado (D10): o consumo de uma sessão de ferramenta externa, informado pelo produtor, uma linha por
// (ferramenta, sessao). A sessão repetida em outro contexto é contada uma vez só, no que a informou primeiro (regra 6).
import type { DatabaseSync } from "node:sqlite";
import type { LinhaDeUso } from "../../harness/publico.ts";
import { instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";

/** `demanda_id` é o identificador opaco do contexto que declarou o Uso. */
export interface UsoDeclarado {
  ferramenta: string;
  sessao: string;
  demanda_id: string;
  linhas: LinhaDeUso[];
}

/**
 * Grava o Uso declarado, idempotente por (ferramenta, sessao): o mesmo contexto informando de novo troca as linhas.
 * O contexto dono também fica em `trabalho_nao_gerenciado`.
 * Devolve o contexto dono da sessão; se não for `uso.demanda_id`, a sessão já constava nele e nada foi gravado.
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

const usoDeclaradoDaLinha = (linha: Record<string, unknown>): UsoDeclarado => ({
  ferramenta: String(linha.ferramenta),
  sessao: String(linha.sessao),
  demanda_id: String(linha.demanda_id),
  linhas: JSON.parse(String(linha.linhas)) as LinhaDeUso[],
});

/** O Uso declarado das sessões cujo dono é o contexto, na ordem em que foram gravadas. */
export const lerUsoDeclarado = (banco: DatabaseSync, demandaId: string): UsoDeclarado[] =>
  banco
    .prepare("SELECT ferramenta, sessao, demanda_id, linhas FROM uso_declarado WHERE demanda_id = ? ORDER BY rowid")
    .all(demandaId)
    .map(usoDeclaradoDaLinha);

/** O Uso declarado das sessões cujo dono é um dos contextos, em lote, na ordem em que foram gravadas. */
export const lerUsoDeclaradoEmLote = (banco: DatabaseSync, demandaIds: readonly string[]): UsoDeclarado[] =>
  instrucaoPreparada(
    banco,
    `SELECT ferramenta, sessao, demanda_id, linhas FROM uso_declarado
       WHERE demanda_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
  )
    .all(JSON.stringify(demandaIds))
    .map(usoDeclaradoDaLinha);

/** Na remoção do projeto: o Uso declarado das `demandas` e as sessões da ferramenta externa que ele cita. */
export function apagarUsoDeclaradoDasDemandas(banco: DatabaseSync, demandas: readonly string[]): void {
  for (const tabela of ["trabalho_nao_gerenciado", "uso_declarado"])
    banco
      .prepare(`DELETE FROM ${tabela} WHERE demanda_id IN (SELECT value FROM json_each(?))`)
      .run(JSON.stringify(demandas));
}

// O banco visto pelos testes que ficam fora do armazenamento (os do CLI): SQL de preparo e de conferência, e as leituras e
// gravações de armazenamento que o cenário precisa. O teste da camada de entrega não importa o armazenamento nem prepara SQL.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export { caminhoArquivo } from "../../src/shared/armazenamento/arquivos.ts";
export { carregarDemanda } from "../../src/modulos/ciclo_de_vida/publico.ts";
export { comDemanda } from "../../src/modulos/ciclo_de_vida/processo/armazenamento/agregado_da_demanda.ts";
export { comSessoesDoContexto as comTrabalhosDoTicket } from "../sessoes_de_teste.ts";

/** Executa o `sql` (insert, update, delete) com os `parametros`. */
export function executarSql(banco: DatabaseSync, sql: string, ...parametros: SQLInputValue[]): void {
  banco.prepare(sql).run(...parametros);
}

/** A primeira linha que o `sql` devolve, ou `undefined`. */
export function lerLinha(banco: DatabaseSync, sql: string, ...parametros: SQLInputValue[]) {
  return banco.prepare(sql).get(...parametros);
}

/** Todas as linhas que o `sql` devolve. */
export function lerLinhas(banco: DatabaseSync, sql: string, ...parametros: SQLInputValue[]) {
  return banco.prepare(sql).all(...parametros);
}

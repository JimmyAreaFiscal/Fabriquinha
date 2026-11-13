// Ler as linhas que um agregado tem em cada tabela: cada dono pede as tabelas dele pelo nome, e a mesma montagem serve a
// um agregado só ou a vários lidos em lote, com uma execução SQL por tabela, qualquer que seja o número de agregados.
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { instrucaoPreparada } from "./banco.ts";

type LinhaLida = Record<string, SQLOutputValue>;

/** As linhas que o agregado tem na `tabela`, na ordem em que foram gravadas. */
export type LinhasDoAgregado = (tabela: string) => LinhaLida[];

/** As linhas do agregado cuja `coluna` vale `id`: uma execução SQL por tabela pedida. */
export const linhasDeUmAgregado =
  (banco: DatabaseSync, coluna: string, id: string): LinhasDoAgregado =>
  (tabela) =>
    instrucaoPreparada(banco, `SELECT * FROM ${tabela} WHERE ${coluna} = ? ORDER BY rowid`).all(id);

/**
 * As linhas de cada agregado de `ids`, lidas em lote: a primeira tabela pedida de qualquer um deles lê as linhas de
 * todos, numa execução SQL só.
 */
export function linhasDosAgregadosEmLote(
  banco: DatabaseSync,
  coluna: string,
  ids: readonly string[],
): (id: string) => LinhasDoAgregado {
  const linhasDeCadaAgregadoPorTabela = new Map<string, Map<string, LinhaLida[]>>();
  const linhasDeCadaAgregadoNa = (tabela: string): Map<string, LinhaLida[]> => {
    const lidas =
      linhasDeCadaAgregadoPorTabela.get(tabela) ??
      Map.groupBy(
        instrucaoPreparada(
          banco,
          `SELECT * FROM ${tabela} WHERE ${coluna} IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
        ).all(JSON.stringify(ids)),
        (linha) => String(linha[coluna]),
      );
    linhasDeCadaAgregadoPorTabela.set(tabela, lidas);
    return lidas;
  };
  return (id) => (tabela) => linhasDeCadaAgregadoNa(tabela).get(id) ?? [];
}

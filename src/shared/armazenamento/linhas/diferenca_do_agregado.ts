// Gravar um agregado em várias tabelas só pela diferença (comparacao-sdlc §7.4): cada dono descreve as tabelas dele e
// grava a diferença delas com estas duas funções, na ordem que as FKs pedem. Não revalida: o domínio valida a transição
// e o banco é a segunda barreira.
import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export type LinhaDaTabela = Record<string, SQLInputValue>;

/** Uma tabela do agregado: a chave da diferença e as linhas que o agregado tem nela. */
export interface TabelaDoAgregado<Agregado> {
  readonly nome: string;
  readonly chave: readonly string[];
  readonly linhas: (agregado: Agregado) => readonly LinhaDaTabela[];
  /** O `id` da linha nasce no INSERT (fora da chave da diferença). */
  readonly idNasceNoInsert?: true;
}

/** No banco o ausente é NULL; no domínio, campo opcional sem a chave. */
export const semNulos = (linha: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(linha).filter(([, valor]) => valor !== null));

/** Troca as colunas `<campo>_*` da linha pelo objeto `campo`; a coluna nula não entra nele. */
export function agruparColunasDoCampo(linha: Record<string, unknown>, campo: string): Record<string, unknown> {
  const agrupado: Record<string, unknown> = {};
  const resto: Record<string, unknown> = {};
  for (const [coluna, valor] of Object.entries(linha)) {
    if (!coluna.startsWith(`${campo}_`)) resto[coluna] = valor;
    else if (valor !== null) agrupado[coluna.slice(campo.length + 1)] = valor;
  }
  return { ...resto, [campo]: agrupado };
}

/** Linhas da tabela no agregado, indexadas pelo JSON dos valores da chave, na ordem de `chave`. */
function linhasPorChave<Agregado>(
  tabela: TabelaDoAgregado<Agregado>,
  agregado: Agregado | undefined,
): Map<string, LinhaDaTabela> {
  const chaveDaLinha = (linha: LinhaDaTabela) => JSON.stringify(tabela.chave.map((coluna) => linha[coluna]));
  return new Map((agregado ? tabela.linhas(agregado) : []).map((linha) => [chaveDaLinha(linha), linha]));
}

/** `a IS $a AND b IS $b` (nomeados) ou `a IS ? AND b IS ?` (posicionais); `IS` casa também o dono nulo. */
const atribuicoes = (colunas: readonly string[], separador: string, operador: string, nomeados = true): string =>
  colunas.map((coluna) => `${coluna} ${operador} ${nomeados ? "$" + coluna : "?"}`).join(separador);

/**
 * Apaga as linhas que sumiram entre `antes` e `depois`, na ordem inversa de `tabelas` (dos filhos para os pais, porque
 * as FKs são RESTRICT).
 */
export function apagarLinhasQueSumiram<Agregado>(
  banco: DatabaseSync,
  tabelas: readonly TabelaDoAgregado<Agregado>[],
  antes: Agregado | undefined,
  depois: Agregado,
): void {
  for (const tabela of tabelas.toReversed()) {
    const novas = linhasPorChave(tabela, depois);
    const sql = `DELETE FROM ${tabela.nome} WHERE ${atribuicoes(tabela.chave, " AND ", "IS", false)}`;
    for (const chaveDaLinha of linhasPorChave(tabela, antes).keys()) {
      if (!novas.has(chaveDaLinha)) banco.prepare(sql).run(...(JSON.parse(chaveDaLinha) as SQLInputValue[]));
    }
  }
}

/**
 * Insere o que é novo e atualiza o que mudou entre `antes` e `depois`, na ordem de `tabelas` (dos pais para os filhos).
 * ponytail: comparação linha a linha por igualdade de JSON; o agregado tem dezenas de linhas. Se passar de
 * milhares, trocar por gravação dirigida por eventos do domínio.
 */
export function gravarLinhasNovasEMudadas<Agregado>(
  banco: DatabaseSync,
  tabelas: readonly TabelaDoAgregado<Agregado>[],
  antes: Agregado | undefined,
  depois: Agregado,
): void {
  for (const tabela of tabelas) {
    const { nome, chave } = tabela;
    const velhas = linhasPorChave(tabela, antes);
    for (const [chaveDaLinha, linha] of linhasPorChave(tabela, depois)) {
      const velha = velhas.get(chaveDaLinha);
      if (!velha) {
        const nova = tabela.idNasceNoInsert ? { id: randomUUID(), ...linha } : linha;
        const colunas = Object.keys(nova);
        const valores = colunas.map((coluna) => "$" + coluna).join(", ");
        banco.prepare(`INSERT INTO ${nome} (${colunas.join(", ")}) VALUES (${valores})`).run(nova);
      } else if (JSON.stringify(velha) !== JSON.stringify(linha)) {
        const sets = atribuicoes(
          Object.keys(linha).filter((coluna) => !chave.includes(coluna)),
          ", ",
          "=",
        );
        banco.prepare(`UPDATE ${nome} SET ${sets} WHERE ${atribuicoes(chave, " AND ", "IS")}`).run(linha);
      }
    }
  }
}

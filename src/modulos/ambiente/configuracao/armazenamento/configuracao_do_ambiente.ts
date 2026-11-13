// A Configuração do Ambiente, na linha única de `configuracao_ambiente`.
import type { DatabaseSync } from "node:sqlite";
import { ConfiguracaoDoAmbiente } from "../nucleo/configuracao_do_ambiente.ts";

const COLUNAS = [
  "tipo",
  "memoria_maxima_mb",
  "cpus",
  "ociosidade_para_eliminar_min",
  "conjunto",
  "capacidade_do_conjunto",
  "minimo_do_conjunto",
] as const satisfies readonly (keyof ConfiguracaoDoAmbiente)[];

/** O Ambiente em que o trabalho roda, os limites de cada container e os do conjunto. Fora de `Configuracao`, que a web grava inteira. */
export function configuracaoDoAmbiente(banco: DatabaseSync): ConfiguracaoDoAmbiente {
  // O node:sqlite devolve objetos sem protótipo; a cópia dá um objeto comum.
  return ConfiguracaoDoAmbiente.parse({
    ...banco.prepare(`SELECT ${COLUNAS.join(", ")} FROM configuracao_ambiente`).get(),
  });
}

/**
 * Grava a configuração do Ambiente inteira, já validada pela aplicação.
 */
export function salvarConfiguracaoDoAmbiente(banco: DatabaseSync, a: ConfiguracaoDoAmbiente): ConfiguracaoDoAmbiente {
  banco
    .prepare(`UPDATE configuracao_ambiente SET ${COLUNAS.map((coluna) => `${coluna} = ?`).join(", ")}`)
    .run(...COLUNAS.map((coluna) => a[coluna]));
  return a;
}

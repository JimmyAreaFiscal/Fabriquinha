// A Configuração do Ambiente, nas colunas `ambiente_*` da linha única de `configuracao`.
import type { DatabaseSync } from "node:sqlite";
import { ConfiguracaoDoAmbiente } from "../nucleo/configuracao_do_ambiente.ts";

/** O Ambiente em que o trabalho roda e os limites de cada container. Fora de `Configuracao`, que a web grava inteira. */
export function configuracaoDoAmbiente(banco: DatabaseSync): ConfiguracaoDoAmbiente {
  const l = banco
    .prepare(
      `SELECT ambiente_tipo, ambiente_memoria_maxima_mb, ambiente_cpus, ambiente_ociosidade_para_eliminar_min
       FROM configuracao`,
    )
    .get() as Record<string, number | string>;
  return ConfiguracaoDoAmbiente.parse({
    tipo: l.ambiente_tipo,
    memoria_maxima_mb: l.ambiente_memoria_maxima_mb,
    cpus: l.ambiente_cpus,
    ociosidade_para_eliminar_min: l.ambiente_ociosidade_para_eliminar_min,
  });
}

/**
 * Grava a configuração do Ambiente inteira, já validada pela aplicação.
 */
export function salvarConfiguracaoDoAmbiente(banco: DatabaseSync, a: ConfiguracaoDoAmbiente): ConfiguracaoDoAmbiente {
  banco
    .prepare(
      `UPDATE configuracao SET ambiente_tipo = ?, ambiente_memoria_maxima_mb = ?, ambiente_cpus = ?,
         ambiente_ociosidade_para_eliminar_min = ?`,
    )
    .run(a.tipo, a.memoria_maxima_mb, a.cpus, a.ociosidade_para_eliminar_min);
  return a;
}

// A Configuração do Ambiente, na linha única de `configuracao_ambiente`.
import type { DatabaseSync } from "node:sqlite";
import { ConfiguracaoDoAmbiente } from "../nucleo/configuracao_do_ambiente.ts";

/** O Ambiente em que o trabalho roda e os limites de cada container. Fora de `Configuracao`, que a web grava inteira. */
export function configuracaoDoAmbiente(banco: DatabaseSync): ConfiguracaoDoAmbiente {
  const l = banco
    .prepare(`SELECT tipo, memoria_maxima_mb, cpus, ociosidade_para_eliminar_min FROM configuracao_ambiente`)
    .get() as Record<string, number | string>;
  return ConfiguracaoDoAmbiente.parse({
    tipo: l.tipo,
    memoria_maxima_mb: l.memoria_maxima_mb,
    cpus: l.cpus,
    ociosidade_para_eliminar_min: l.ociosidade_para_eliminar_min,
  });
}

/**
 * Grava a configuração do Ambiente inteira, já validada pela aplicação.
 */
export function salvarConfiguracaoDoAmbiente(banco: DatabaseSync, a: ConfiguracaoDoAmbiente): ConfiguracaoDoAmbiente {
  banco
    .prepare(
      `UPDATE configuracao_ambiente SET tipo = ?, memoria_maxima_mb = ?, cpus = ?, ociosidade_para_eliminar_min = ?`,
    )
    .run(a.tipo, a.memoria_maxima_mb, a.cpus, a.ociosidade_para_eliminar_min);
  return a;
}

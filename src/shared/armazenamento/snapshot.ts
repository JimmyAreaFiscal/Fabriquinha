import type { DatabaseSync } from "node:sqlite";

/** Roda `leitura` num snapshot só; dentro de `escrever` a leitura já é parte da transação. */
export function lerEmSnapshot<T>(banco: DatabaseSync, leitura: () => T): T {
  const abreTransacaoPropria = !banco.isTransaction;
  if (abreTransacaoPropria) banco.exec("BEGIN");
  try {
    return leitura();
  } finally {
    if (abreTransacaoPropria) banco.exec("COMMIT");
  }
}

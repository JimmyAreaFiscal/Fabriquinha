// O limite de tempo do pi nos testes das etapas interativas: o pi ocioso só termina quando a ociosidade passa, e a
// condução lê o limite da configuração.
import type { DatabaseSync } from "node:sqlite";

/** Reduz o limite do pi na configuração para `minutos`, para a execução terminar logo e o `fim` poder ser esperado. */
export function limitarTempoDoPi(banco: DatabaseSync, minutos: number): void {
  // A coluna só aceita de 10 a 1440 min; o teste precisa de segundos.
  banco.exec("PRAGMA ignore_check_constraints = ON");
  banco.exec(`UPDATE configuracao SET timeout_min = ${String(minutos)}`);
  banco.exec("PRAGMA ignore_check_constraints = OFF");
}

// O registro técnico (F2 §2, F4 §7): o log de uma operação do serviço, a linha com horário num log e a linha no log do
// serviço.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Relogio, relogioDoSistema } from "../nucleo/relogio.ts";

/** O log `<raiz>/execucoes/<nome>.log` de uma operação do serviço que não é um processo (planejar, encerrar, ajustar). */
export function logDaOperacao(raiz: string, nome: string): string {
  mkdirSync(join(raiz, "execucoes"), { recursive: true });
  return join(raiz, "execucoes", `${nome}.log`);
}

/** Uma linha com horário no log da execução (o `log` da pasta dela). */
export const anotar = (log: string, texto: string, relogio: Relogio = relogioDoSistema): void => {
  appendFileSync(log, `${relogio.agora()} ${texto}\n`);
};

/** O log do serviço é o stderr, que o systemd guarda (F4 §2). */
export const noLog = (erro: unknown, relogio: Relogio = relogioDoSistema): void => {
  console.error(`${relogio.agora()} fabriquinha:`, erro);
};

// Arquivos de uma execução fora do agregado (F2 §2, F4 §6.1.2, §7): as pastas e o log do processo, a pasta histórica da
// execução simulada e a linha no log do serviço.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Id } from "../nucleo/primitivos.ts";
import { type Relogio, relogioDoSistema } from "../nucleo/relogio.ts";

/** `<raiz>/simulacoes/<n>`: a pasta da execução simulada `n`, da Simulação que saiu (ticket 02); a remoção do projeto a apaga. */
export const dirDaExecucaoSimulada = (raiz: string, execucao: Id): string => join(raiz, "simulacoes", String(execucao));

/** `<raiz>/execucoes/E-<id>`: a pasta do processo `id` (prompt, `saida/`, `vazio/`) e o `log` dentro dela. */
export const pastasDoProcesso = (raiz: string, id: string | number): { dir: string; log: string } => {
  const dir = join(raiz, "execucoes", `E-${String(id)}`);
  return { dir, log: join(dir, "log") };
};

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

// As pastas de uma execução fora do agregado (F2 §2, F4 §6.1.2): as do processo e a histórica da execução simulada.
import { join } from "node:path";
import type { Id } from "../nucleo/primitivos.ts";

// provisório: remover no ticket 22 (o registro técnico morou aqui; agora vem de src/shared/infra/registro.ts)
export { anotar, logDaOperacao, noLog } from "../../../shared/infra/registro.ts";

/** `<raiz>/simulacoes/<n>`: a pasta da execução simulada `n`, da Simulação que saiu (ticket 02); a remoção do projeto a apaga. */
export const dirDaExecucaoSimulada = (raiz: string, execucao: Id): string => join(raiz, "simulacoes", String(execucao));

/** `<raiz>/execucoes/E-<id>`: a pasta do processo `id` (prompt, `saida/`, `vazio/`) e o `log` dentro dela. */
export const pastasDoProcesso = (raiz: string, id: string | number): { dir: string; log: string } => {
  const dir = join(raiz, "execucoes", `E-${String(id)}`);
  return { dir, log: join(dir, "log") };
};

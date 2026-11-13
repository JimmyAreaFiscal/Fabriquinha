// As pastas de uma execução fora do agregado (F2 §2, F4 §6.1.2): as do processo.
import { join } from "node:path";

// provisório: remover no ticket 22 (o registro técnico morou aqui; agora vem de src/shared/infra/registro.ts)
export { anotar, logDaOperacao, noLog } from "../../../shared/infra/registro.ts";

/** `<raiz>/execucoes/E-<id>`: a pasta do processo `id` (prompt, `saida/`, `vazio/`) e o `log` dentro dela. */
export const pastasDoProcesso = (raiz: string, id: string | number): { dir: string; log: string } => {
  const dir = join(raiz, "execucoes", `E-${String(id)}`);
  return { dir, log: join(dir, "log") };
};

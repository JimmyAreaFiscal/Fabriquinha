// As pastas de uma execução fora do banco (F2 §2, F4 §6.1.2): onde quem pede a sessão grava o prompt e onde fica o log.
import { join } from "node:path";

/** `<raiz>/execucoes/E-<id>`: a pasta do processo `id` (prompt, `saida/`, `vazio/`) e o `log` dentro dela. */
export const pastasDoProcesso = (raiz: string, id: string | number): { dir: string; log: string } => {
  const dir = join(raiz, "execucoes", `E-${String(id)}`);
  return { dir, log: join(dir, "log") };
};

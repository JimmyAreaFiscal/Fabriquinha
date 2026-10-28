// O commit de um ticket e o que ele mudou por arquivo (F5 §4, §7), sem banco: as migrações também usam o status.
import { z } from "zod";

/** Adicionado, modificado, removido ou renomeado (F5 §7). */
export const StatusArquivo = z.enum(["A", "M", "D", "R"]);
export type StatusArquivo = z.infer<typeof StatusArquivo>;

export interface ArquivoCommit {
  caminho: string;
  /** Só em renomeação. */
  caminhoAnterior?: string;
  status: StatusArquivo;
  /** `null` em arquivo binário. */
  adicionadas: number | null;
  removidas: number | null;
}

export interface Commit {
  sha: string;
  mensagem: string;
  em: string;
  arquivos: ArquivoCommit[];
}

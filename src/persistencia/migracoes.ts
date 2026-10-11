// Migrações do banco (F2 §3.7): lista ordenada; a posição + 1 é a versão gravada em `PRAGMA user_version`.
// Só se acrescenta ao fim; migração já aplicada não muda.
import type { z } from "zod";
import { TipoId } from "../dominio/primitivos.ts";

/** Lista de um `CHECK ... IN (...)` gerada de um enum zod, para o banco e o domínio não divergirem. */
export const listaSql = (enumeracao: z.ZodEnum): string =>
  enumeracao.options.map((v) => `'${String(v).replaceAll("'", "''")}'`).join(",");

export const MIGRACOES: readonly string[] = [
  `CREATE TABLE sequencia (
    nome  TEXT PRIMARY KEY CHECK (nome IN (${listaSql(TipoId)})),
    valor INTEGER NOT NULL CHECK (valor >= 0)
  );`,
];

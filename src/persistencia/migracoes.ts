// Migrações do banco (F2 §3.7): lista ordenada; a posição + 1 é a versão gravada em `PRAGMA user_version`.
// Só se acrescenta ao fim; migração já aplicada não muda.
import type { z } from "zod";
import { TipoId } from "../dominio/primitivos.ts";
import { Hospedagem } from "../dominio/projeto.ts";

/** Lista de um `CHECK ... IN (...)` gerada de um enum zod, para o banco e o domínio não divergirem. */
export const listaSql = (enumeracao: z.ZodEnum): string =>
  enumeracao.options.map((v) => `'${String(v).replaceAll("'", "''")}'`).join(",");

export const MIGRACOES: readonly string[] = [
  `CREATE TABLE sequencia (
    nome  TEXT PRIMARY KEY CHECK (nome IN (${listaSql(TipoId)})),
    valor INTEGER NOT NULL CHECK (valor >= 0)
  );`,
  `CREATE TABLE projeto (
    nome              TEXT PRIMARY KEY CHECK (length(nome) BETWEEN 1 AND 64),
    repo              TEXT NOT NULL UNIQUE,
    branch_base       TEXT NOT NULL,
    hospedagem        TEXT NOT NULL CHECK (hospedagem IN (${listaSql(Hospedagem)})),
    preparacao        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(preparacao)),
    testes            TEXT NOT NULL CHECK (json_valid(testes) AND json_array_length(testes) >= 1),
    sonar_project_key TEXT NOT NULL,
    fitness           TEXT NOT NULL CHECK (json_valid(fitness) AND json_array_length(fitness) >= 1),
    modelos           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(modelos))
  );`,
];

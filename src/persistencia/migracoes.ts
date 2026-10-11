// Migrações do banco (F2 §3.7): lista ordenada; a posição + 1 é a versão gravada em `PRAGMA user_version`.
// Só se acrescenta ao fim; migração já aplicada não muda.
import type { z } from "zod";
import { StatusTicket, TipoAtor, TipoIssue } from "../dominio/agregado.ts";
import { Etapa, Fase, TipoId } from "../dominio/primitivos.ts";
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
  `CREATE TABLE issue (
    id           INTEGER PRIMARY KEY,
    projeto      TEXT NOT NULL REFERENCES projeto(nome),
    titulo       TEXT CHECK (length(titulo) BETWEEN 1 AND 120),
    tipo         TEXT CHECK (tipo IN (${listaSql(TipoIssue)})),
    descricao    TEXT NOT NULL DEFAULT '',
    fase         TEXT NOT NULL CHECK (fase IN (${listaSql(Fase)})),
    criada_em    TEXT NOT NULL,
    concluida_em TEXT,
    arquivada_em TEXT,
    CHECK ((fase = 'concluida') = (concluida_em IS NOT NULL)),
    CHECK (arquivada_em IS NULL OR fase = 'concluida'),
    CHECK (fase = 'registro' OR (titulo IS NOT NULL AND tipo IS NOT NULL))
  );
  CREATE TABLE issue_dep (
    issue INTEGER NOT NULL REFERENCES issue(id),
    dep   INTEGER NOT NULL REFERENCES issue(id),
    PRIMARY KEY (issue, dep),
    CHECK (issue <> dep)
  );
  CREATE TABLE ticket (
    id              INTEGER PRIMARY KEY,
    issue           INTEGER NOT NULL REFERENCES issue(id),
    etapa           TEXT NOT NULL CHECK (etapa IN (${listaSql(Etapa)})),
    titulo          TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
    descricao       TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL CHECK (status IN (${listaSql(StatusTicket)})),
    origem          TEXT NOT NULL CHECK (origem IN (${listaSql(TipoAtor)})),
    origem_ticket   INTEGER REFERENCES ticket(id),
    modelo_provedor TEXT,
    modelo_nome     TEXT,
    instrucao       TEXT,
    erro            TEXT,
    criado_em       TEXT NOT NULL,
    concluido_em    TEXT,
    CHECK ((status = 'falhou') = (erro IS NOT NULL)),
    CHECK ((status = 'concluido') = (concluido_em IS NOT NULL)),
    CHECK (origem <> 'agente' OR origem_ticket IS NOT NULL),
    CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
  );
  -- Invariante 1 do F1: no máximo um ticket em execução por issue.
  CREATE UNIQUE INDEX ux_ticket_em_execucao ON ticket(issue) WHERE status = 'em_execucao';
  -- Invariante 2 do F1: etapas diferentes de desenvolvimento têm no máximo um ticket não concluído por issue.
  CREATE UNIQUE INDEX ux_ticket_etapa_unica ON ticket(issue, etapa) WHERE etapa <> 'desenvolvimento' AND status <> 'concluido';
  -- F6 §7: uma linha por comando aplicado por comIssue, com a fase da issue antes dele.
  CREATE TABLE comando (
    id    INTEGER PRIMARY KEY,
    issue INTEGER NOT NULL REFERENCES issue(id),
    nome  TEXT    NOT NULL,
    ator  TEXT    NOT NULL CHECK (ator IN (${listaSql(TipoAtor)})),
    fase  TEXT    NOT NULL CHECK (fase IN (${listaSql(Fase)})),
    em    TEXT    NOT NULL
  );`,
];

// Migrações do banco (F2 §3.7): lista ordenada; a posição + 1 é a versão gravada em `PRAGMA user_version`.
// Só se acrescenta ao fim; migração já aplicada não muda.
import type { z } from "zod";
import {
  Decisao,
  GateDecisao,
  ModoExecucao,
  Produtor,
  ResultadoExecucao,
  StatusTicket,
  TipoAtor,
  TipoEvidencia,
  TipoIssue,
} from "../dominio/agregado.ts";
import { Etapa, Fase, TipoId } from "../dominio/primitivos.ts";
import { Hospedagem } from "../dominio/projeto.ts";
import { StatusArquivo } from "./commits.ts";

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
  `CREATE TABLE execucao (
    id              INTEGER PRIMARY KEY,
    ticket          INTEGER NOT NULL REFERENCES ticket(id),
    modo            TEXT NOT NULL CHECK (modo IN (${listaSql(ModoExecucao)})),
    sessao_pi       TEXT NOT NULL,
    modelo_provedor TEXT,
    modelo_nome     TEXT,
    pgid_pi         INTEGER, -- F4 §7: grupo de processos do pi, para encerrar sobras após reinício
    resultado       TEXT NOT NULL CHECK (resultado IN (${listaSql(ResultadoExecucao)})),
    erro            TEXT,
    iniciada_em     TEXT NOT NULL,
    terminada_em    TEXT,
    CHECK ((resultado = 'em_andamento') = (terminada_em IS NULL)),
    CHECK ((resultado = 'falha') = (erro IS NOT NULL)),
    CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
  );
  -- Uma execução em andamento por ticket.
  CREATE UNIQUE INDEX ux_execucao_por_ticket ON execucao(ticket) WHERE resultado = 'em_andamento';
  -- Invariante 3 do F1 (D8): uma execução autônoma em andamento no sistema inteiro.
  CREATE UNIQUE INDEX ux_execucao_autonoma ON execucao(modo) WHERE modo = 'autonomo' AND resultado = 'em_andamento';`,
  `CREATE TABLE decisao (
    id       INTEGER PRIMARY KEY,
    issue    INTEGER NOT NULL REFERENCES issue(id),
    ticket   INTEGER NOT NULL REFERENCES ticket(id),
    gate     TEXT NOT NULL CHECK (gate IN (${listaSql(GateDecisao)})),
    aprovado INTEGER NOT NULL CHECK (aprovado IN (0,1)),
    motivo   TEXT CHECK (length(motivo) BETWEEN 1 AND 2000),
    nota     INTEGER CHECK (nota BETWEEN 1 AND 5),
    por      TEXT NOT NULL CHECK (por IN (${listaSql(Decisao.shape.por)})),
    em       TEXT NOT NULL,
    -- Invariante 7 do F1.
    CHECK ((por = 'agente') = (gate = 'revisao')),
    CHECK (aprovado = 1 OR motivo IS NOT NULL),
    -- F1 §3.7: a nota vem só com o PR aprovado (o F2 ainda diz gate = 'pr', o que exigiria nota ao pedir mudanças).
    CHECK ((nota IS NOT NULL) = (gate = 'pr' AND aprovado = 1))
  );
  CREATE UNIQUE INDEX ux_decisao_revisao ON decisao(ticket) WHERE gate = 'revisao';
  CREATE TABLE evidencia (
    id       INTEGER PRIMARY KEY,
    ticket   INTEGER NOT NULL REFERENCES ticket(id),
    tipo     TEXT NOT NULL CHECK (tipo IN (${listaSql(TipoEvidencia)})),
    produtor TEXT NOT NULL CHECK (produtor IN (${listaSql(Produtor)})),
    aprovada INTEGER CHECK (aprovada IN (0,1)),
    dados    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dados)),
    em       TEXT NOT NULL,
    UNIQUE (ticket, tipo)
  );
  CREATE TABLE evidencia_arquivo (
    evidencia INTEGER NOT NULL REFERENCES evidencia(id) ON DELETE CASCADE,
    nome      TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
    sha256    TEXT NOT NULL CHECK (length(sha256) = 64),
    mime      TEXT NOT NULL,
    bytes     INTEGER NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (evidencia, nome)
  );`,
  // F4 §10: configuração do serviço (F4 §3), linha única já com os padrões.
  `CREATE TABLE configuracao (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    agendador_ativo  INTEGER NOT NULL DEFAULT 0 CHECK (agendador_ativo IN (0,1)),
    intervalo_min    INTEGER NOT NULL DEFAULT 5   CHECK (intervalo_min BETWEEN 1 AND 1440),
    timeout_min      INTEGER NOT NULL DEFAULT 120 CHECK (timeout_min BETWEEN 10 AND 1440),
    ociosidade_min   INTEGER NOT NULL DEFAULT 30  CHECK (ociosidade_min BETWEEN 5 AND 1440)
  );
  INSERT INTO configuracao (id) VALUES (1);`,
  // F5 §7: o commit de cada ticket de desenvolvimento e o que ele mudou, por arquivo.
  `CREATE TABLE commit_ticket (
    sha      TEXT PRIMARY KEY CHECK (length(sha) IN (40, 64)),
    ticket   INTEGER NOT NULL UNIQUE REFERENCES ticket(id),
    mensagem TEXT NOT NULL,
    em       TEXT NOT NULL
  );
  CREATE TABLE arquivo_commit (
    sha              TEXT NOT NULL REFERENCES commit_ticket(sha),
    caminho          TEXT NOT NULL,
    caminho_anterior TEXT,
    status           TEXT NOT NULL CHECK (status IN (${listaSql(StatusArquivo)})),
    adicionadas      INTEGER CHECK (adicionadas >= 0),
    removidas        INTEGER CHECK (removidas >= 0),
    PRIMARY KEY (sha, caminho),
    CHECK ((status = 'R') = (caminho_anterior IS NOT NULL))
  );
  -- Para o F6: alterações e bugs por arquivo.
  CREATE INDEX ix_arquivo_commit_caminho ON arquivo_commit(caminho);`,
  // F6 §7: tokens e custo por execução × provedor/modelo, regravados por coletarUso (F6 §3.3).
  `CREATE TABLE uso (
    execucao    INTEGER NOT NULL REFERENCES execucao(id),
    provedor    TEXT    NOT NULL,
    modelo      TEXT    NOT NULL,
    chamadas    INTEGER NOT NULL CHECK (chamadas >= 1),
    input       INTEGER NOT NULL CHECK (input >= 0),
    output      INTEGER NOT NULL CHECK (output >= 0),
    cache_read  INTEGER NOT NULL CHECK (cache_read >= 0),
    cache_write INTEGER NOT NULL CHECK (cache_write >= 0),
    custo       REAL    NOT NULL CHECK (custo >= 0), -- US$, como o pi calculou
    PRIMARY KEY (execucao, provedor, modelo)
  );`,
  // F6 §7: linhas de um ticket reescritas depois, por outro ticket ou por commit humano, e o cursor da varredura.
  `CREATE TABLE retrabalho (
    commit_alterador TEXT    NOT NULL,
    ticket           INTEGER REFERENCES ticket(id),
    autor            TEXT,
    ticket_origem    INTEGER NOT NULL REFERENCES ticket(id),
    linhas           INTEGER NOT NULL CHECK (linhas >= 1),
    PRIMARY KEY (commit_alterador, ticket_origem),
    CHECK (ticket IS NULL OR ticket <> ticket_origem),
    CHECK ((ticket IS NULL) = (autor IS NOT NULL))
  );
  CREATE INDEX ix_retrabalho_origem ON retrabalho(ticket_origem);
  CREATE TABLE varredura_base (
    projeto    TEXT PRIMARY KEY REFERENCES projeto(nome),
    ultimo_sha TEXT NOT NULL CHECK (length(ultimo_sha) IN (40, 64)),
    em         TEXT NOT NULL
  );`,
  // F1 C22: issue cancelada e os status de ticket `fechado` e `cancelado`. O CHECK de `status` não se altera no
  // SQLite, então `ticket` é recriada (receita do SQLite: tabela nova, cópia, DROP, RENAME). `migrar` desliga as FKs
  // e confere `foreign_key_check` antes do COMMIT, porque com FK ligada o DROP falha.
  `ALTER TABLE issue ADD COLUMN cancelada_em TEXT CHECK (cancelada_em IS NULL OR fase <> 'concluida');
  CREATE TABLE ticket_novo (
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
  INSERT INTO ticket_novo SELECT * FROM ticket;
  DROP TABLE ticket;
  ALTER TABLE ticket_novo RENAME TO ticket;
  CREATE UNIQUE INDEX ux_ticket_em_execucao ON ticket(issue) WHERE status = 'em_execucao';
  CREATE UNIQUE INDEX ux_ticket_etapa_unica ON ticket(issue, etapa) WHERE etapa <> 'desenvolvimento' AND status <> 'concluido';
  -- As dependentes de uma issue (busca reversa do cancelamento).
  CREATE INDEX ix_issue_dep_dep ON issue_dep(dep);`,
];

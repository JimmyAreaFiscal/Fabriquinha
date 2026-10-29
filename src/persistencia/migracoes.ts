// Migrações do banco (F2 §3.7): lista ordenada; a posição + 1 é a versão gravada em `PRAGMA user_version`.
// Só se acrescenta ao fim; migração já aplicada não muda.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  Decisao,
  GateDecisao,
  ModoExecucao,
  Produtor,
  ResultadoExecucao,
  StatusProposta,
  StatusTicket,
  TipoAtor,
  TipoEvidencia,
  TipoIssue,
} from "../dominio/agregado.ts";
import { TipoEvidenciaAgregado } from "../dominio/agregado_demanda.ts";
import { ProgressoEncerramento } from "../dominio/encerramento_demanda.ts";
import { Effort, Etapa, EtapaTicket, Fase, FaseDemanda, FaseRodada, TipoId } from "../dominio/primitivos.ts";
import { Hospedagem } from "../dominio/projeto.ts";
import { StatusExecucaoSimulada } from "../dominio/simulacao.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { StatusArquivo } from "./commits.ts";

/** Lista de um `CHECK ... IN (...)` gerada de um enum zod, para o banco e o domínio não divergirem. */
export const listaSql = (enumeracao: z.ZodEnum): string =>
  enumeracao.options.map((v) => `'${String(v).replaceAll("'", "''")}'`).join(",");

/** Lista de tipos congelada da migração 24: a partir da 30 o CHECK acompanha `TipoEvidenciaAgregado`. */
const TIPOS_EVIDENCIA_MIGRACAO_24 = z.enum([...TipoEvidencia.options, "custos_realizados", "plano"]);

/** Uma migração é SQL ou, quando precisa conferir algo e recusar com orientação, uma função; roda na transação do `migrar`. */
export type Migracao = string | ((banco: DatabaseSync) => void);

/** As tabelas do fluxo legado que a migração 33 apaga, depois de copiar iterações e propostas. */
const TABELAS_LEGADAS = [
  "issue",
  "issue_dep",
  "ticket",
  "comando",
  "execucao",
  "decisao",
  "evidencia",
  "evidencia_arquivo",
  "commit_ticket",
  "arquivo_commit",
  "uso",
  "retrabalho",
  "proposta_issue",
  "iteracao",
];

/** O ticket legado é o ticket da demanda `I-<issue>` com o mesmo número, como o cutover (I-245) o copiou. */
const TICKET_DA_DEMANDA =
  "JOIN ticket t ON t.id = x.ticket JOIN ticket_demanda td ON td.demanda_id = 'I-' || t.issue AND td.ticket_id = t.id";

const COPIAR_PARA_A_DEMANDA = `CREATE TABLE iteracao_demanda (
    id         INTEGER PRIMARY KEY,
    demanda_id TEXT NOT NULL,
    ticket_id  INTEGER NOT NULL,
    tipo       TEXT NOT NULL CHECK (tipo IN ('mensagem','dialogo','reabertura')),
    em         TEXT NOT NULL,
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id)
  );
  CREATE TABLE proposta_demanda (
    id                INTEGER PRIMARY KEY,
    demanda_id        TEXT NOT NULL,
    ticket_id         INTEGER NOT NULL,
    titulo            TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
    mensagem          TEXT NOT NULL CHECK (length(trim(mensagem)) >= 1),
    arquivos          INTEGER NOT NULL CHECK (arquivos >= 0),
    status            TEXT NOT NULL CHECK (status IN ('pendente','aceita','recusada')),
    demanda_criada_id TEXT REFERENCES demanda(id),
    em                TEXT NOT NULL,
    decidida_em       TEXT,
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    CHECK ((status = 'aceita') = (demanda_criada_id IS NOT NULL)),
    CHECK ((status = 'pendente') = (decidida_em IS NULL))
  );
  INSERT INTO iteracao_demanda SELECT x.id, td.demanda_id, td.ticket_id, x.tipo, x.em FROM iteracao x ${TICKET_DA_DEMANDA} ORDER BY x.id;
  INSERT INTO proposta_demanda
    SELECT x.id, td.demanda_id, td.ticket_id, x.titulo, x.mensagem, x.arquivos, x.status, 'I-' || x.issue_criada, x.em,
           x.decidida_em
      FROM proposta_issue x ${TICKET_DA_DEMANDA} ORDER BY x.id;
  -- O retrabalho que o legado gravou depois do cutover (commits humanos varridos antes da I-247 R1) completa o da demanda;
  -- o que o cutover já copiou fica como está, e o ticket sem par na demanda cai na conferência de FK do \`migrar\`.
  INSERT OR IGNORE INTO retrabalho_demanda
    (commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id)
    SELECT r.commit_alterador, 'I-' || o.issue, r.ticket, r.autor, r.ticket_origem, r.linhas,
           CASE WHEN r.ticket IS NOT NULL THEN 'I-' || a.issue END
      FROM retrabalho r JOIN ticket o ON o.id = r.ticket_origem LEFT JOIN ticket a ON a.id = r.ticket
      ORDER BY r.rowid;`;

/**
 * O modelo e o effort de cada etapa legada (`projeto.modelos`, `projeto.efforts`) nas etapas do ticket que a herdaram,
 * só para o projeto que ainda não tem nenhuma etapa configurada: a configuração nova, se existe, vale.
 */
const COPIAR_MODELOS_E_EFFORTS = `WITH etapa_herdada (legada, nova) AS (VALUES
    ('registro', 'demanda'), ('desenho', 'planejar'), ('desenvolvimento', 'implementar'),
    ('desenvolvimento', 'resolver_conflito'), ('revisao', 'revisar_rodada'), ('revisao', 'revisar_demanda'),
    ('encerramento', 'encerrar_rodada'), ('encerramento', 'encerrar_demanda'), ('sessao', 'sessao_em_aberto')
  ), legado AS (
    SELECT p.nome AS projeto, e.nova AS etapa,
           json_extract(p.modelos, '$.' || e.legada || '.provedor') AS provedor,
           json_extract(p.modelos, '$.' || e.legada || '.modelo') AS modelo,
           json_extract(p.efforts, '$.' || e.legada) AS effort
      FROM projeto p CROSS JOIN etapa_herdada e
     WHERE NOT EXISTS (SELECT 1 FROM configuracao_etapa_projeto c WHERE c.projeto = p.nome)
  )
  INSERT INTO configuracao_etapa_projeto (projeto, etapa, modelo_provedor, modelo_nome, effort)
    SELECT projeto, etapa, provedor, modelo, effort FROM legado
     WHERE provedor IS NOT NULL OR effort IS NOT NULL
     ORDER BY projeto, etapa;`;

/**
 * Remoção do fluxo legado (I-247, comparacao-sdlc §10): recusa sem tocar em nada se alguma issue não virou demanda;
 * copia iterações e propostas para tabelas da demanda, conferindo as contagens, completa o retrabalho da demanda, copia
 * o modelo e o effort de cada etapa e só então apaga as tabelas e as colunas legadas do projeto. A sequência `issue`
 * fica: ela dá o I-<n> das demandas.
 */
function removerFluxoLegado(banco: DatabaseSync): void {
  const semDemanda = banco
    .prepare("SELECT 'I-' || id AS id FROM issue WHERE 'I-' || id NOT IN (SELECT id FROM demanda) ORDER BY issue.id")
    .all()
    .map((l) => String(l.id));
  if (semDemanda.length > 0) {
    throw new ErroDeRegra(
      `${semDemanda.join(", ")} sem demanda correspondente: esta versão apaga o fluxo legado e não migra mais issues`,
      "suba a versão anterior da Fabriquinha, que migra as issues para demandas na subida, e depois esta de novo",
    );
  }
  banco.exec(COPIAR_PARA_A_DEMANDA);
  for (const [legada, nova] of [
    ["iteracao", "iteracao_demanda"],
    ["proposta_issue", "proposta_demanda"],
  ] as const) {
    const contar = (tabela: string) => Number(banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n);
    if (contar(legada) !== contar(nova)) {
      throw new ErroDeRegra(
        `a migração copiou ${String(contar(nova))} das ${String(contar(legada))} linhas de ${legada}: há ticket legado sem ticket da demanda`,
        "restaure o banco do backup e relate o problema",
      );
    }
  }
  banco.exec(TABELAS_LEGADAS.map((tabela) => `DROP TABLE ${tabela};`).join("\n"));
  banco.exec(COPIAR_MODELOS_E_EFFORTS);
  banco.exec(
    ["testes", "fitness", "modelos", "efforts"]
      .map((coluna) => `ALTER TABLE projeto DROP COLUMN ${coluna};`)
      .join("\n"),
  );
}

export const MIGRACOES: readonly Migracao[] = [
  // A lista é fixa: o tipo `proposta` entra na migração 16, que recria `sequencia`.
  `CREATE TABLE sequencia (
    nome  TEXT PRIMARY KEY CHECK (nome IN ('issue','ticket','execucao','decisao','evidencia')),
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
  // O D8 saiu (uma execução autônoma por issue, em paralelo): o índice único vira comum e segue servindo à consulta
  // das autônomas em andamento. A trava por issue continua em ux_execucao_por_ticket e na C5.
  `DROP INDEX ux_execucao_autonoma;
  CREATE INDEX ix_execucao_autonoma ON execucao(modo) WHERE modo = 'autonomo' AND resultado = 'em_andamento';`,
  `ALTER TABLE projeto ADD COLUMN link_produto TEXT;`,
  // F8 (I-10): os Usuários Simulados do projeto e os anexos que vão para a IA; o conteúdo fica em arquivos/ pelo sha256.
  `CREATE TABLE usuario_simulado (
    id        INTEGER PRIMARY KEY,
    projeto   TEXT NOT NULL REFERENCES projeto(nome),
    nome      TEXT NOT NULL,
    descricao TEXT NOT NULL,
    UNIQUE (projeto, nome)
  );
  CREATE TABLE usuario_simulado_anexo (
    usuario INTEGER NOT NULL REFERENCES usuario_simulado(id),
    nome    TEXT NOT NULL,
    sha256  TEXT NOT NULL CHECK (length(sha256) = 64),
    bytes   INTEGER NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (usuario, nome)
  );`,
  // F8 (I-10): as Tarefas do projeto, com N execuções por usuário, e os Usuários Simulados alocados a cada uma.
  `CREATE TABLE tarefa (
    id        INTEGER PRIMARY KEY,
    projeto   TEXT NOT NULL REFERENCES projeto(nome),
    texto     TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 2000),
    n         INTEGER NOT NULL CHECK (n BETWEEN 1 AND 20),
    criada_em TEXT NOT NULL
  );
  CREATE INDEX ix_tarefa_projeto ON tarefa(projeto);
  CREATE TABLE tarefa_usuario (
    tarefa  INTEGER NOT NULL REFERENCES tarefa(id),
    usuario INTEGER NOT NULL REFERENCES usuario_simulado(id),
    PRIMARY KEY (tarefa, usuario)
  );`,
  // F8 (I-10): as execuções simuladas de cada Tarefa, uma por usuário alocado e por N; o relatório é JSON e o `pgid` é o
  // do pi em andamento, para o reinício matá-lo.
  `CREATE TABLE execucao_simulada (
    id           INTEGER PRIMARY KEY,
    tarefa       INTEGER NOT NULL REFERENCES tarefa(id),
    usuario      INTEGER NOT NULL REFERENCES usuario_simulado(id),
    status       TEXT NOT NULL CHECK (status IN (${listaSql(StatusExecucaoSimulada)})),
    relatorio    TEXT CHECK (relatorio IS NULL OR json_valid(relatorio)),
    erro         TEXT,
    pgid         INTEGER,
    iniciada_em  TEXT,
    terminada_em TEXT,
    CHECK ((status = 'falhou') = (erro IS NOT NULL)),
    CHECK ((status = 'concluida') = (relatorio IS NOT NULL))
  );
  CREATE INDEX ix_execucao_simulada_tarefa ON execucao_simulada(tarefa);
  CREATE INDEX ix_execucao_simulada_pendente ON execucao_simulada(tarefa) WHERE status IN ('na_fila', 'em_andamento');`,
  // Proposta de issue (C23, C24): fato preso ao ticket que a fez. O CHECK de `sequencia` não se altera no SQLite, então
  // ela é recriada com o tipo `proposta` (tabela nova, cópia, DROP, RENAME), preservando os valores.
  `CREATE TABLE proposta_issue (
    id           INTEGER PRIMARY KEY,
    ticket       INTEGER NOT NULL REFERENCES ticket(id),
    titulo       TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
    mensagem     TEXT NOT NULL CHECK (length(trim(mensagem)) >= 1),
    arquivos     INTEGER NOT NULL CHECK (arquivos >= 0),
    status       TEXT NOT NULL CHECK (status IN (${listaSql(StatusProposta)})),
    issue_criada INTEGER REFERENCES issue(id),
    em           TEXT NOT NULL,
    decidida_em  TEXT,
    CHECK ((status = 'aceita') = (issue_criada IS NOT NULL)),
    CHECK ((status = 'pendente') = (decidida_em IS NULL))
  );
  CREATE INDEX ix_proposta_issue_ticket ON proposta_issue(ticket);
  CREATE TABLE sequencia_nova (
    nome  TEXT PRIMARY KEY CHECK (nome IN (${listaSql(TipoId)})),
    valor INTEGER NOT NULL CHECK (valor >= 0)
  );
  INSERT INTO sequencia_nova SELECT nome, valor FROM sequencia;
  DROP TABLE sequencia;
  ALTER TABLE sequencia_nova RENAME TO sequencia;`,
  // C25: o registro e o desenho esperam o Auditor com o ticket em execução e `enviado_em`. O desenho que já esperava o
  // gate no formato anterior (ticket concluído, issue em aprovacao_desenho) volta a em execução, enviado quando
  // concluiu. A aula do código entra, e o vídeo explicativo vira o vídeo de demonstração (mesmo formato); o CHECK de
  // `tipo` não se altera no SQLite, então `evidencia` é recriada (tabela nova, cópia, DROP, RENAME).
  `ALTER TABLE ticket ADD COLUMN enviado_em TEXT CHECK (enviado_em IS NULL OR etapa IN ('registro','desenho'));
  UPDATE ticket SET status = 'em_execucao', enviado_em = concluido_em, concluido_em = NULL
   WHERE id IN (SELECT max(t.id) FROM ticket t JOIN issue i ON i.id = t.issue
                 WHERE t.etapa = 'desenho' AND t.status = 'concluido'
                   AND i.fase = 'aprovacao_desenho' AND i.cancelada_em IS NULL
                 GROUP BY t.issue);
  CREATE TABLE evidencia_nova (
    id       INTEGER PRIMARY KEY,
    ticket   INTEGER NOT NULL REFERENCES ticket(id),
    tipo     TEXT NOT NULL CHECK (tipo IN (${listaSql(TipoEvidencia)})),
    produtor TEXT NOT NULL CHECK (produtor IN (${listaSql(Produtor)})),
    aprovada INTEGER CHECK (aprovada IN (0,1)),
    dados    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dados)),
    em       TEXT NOT NULL,
    UNIQUE (ticket, tipo)
  );
  INSERT INTO evidencia_nova
    SELECT id, ticket, CASE tipo WHEN 'video_explicativo' THEN 'video_demonstracao' ELSE tipo END,
           produtor, aprovada, dados, em
      FROM evidencia;
  DROP TABLE evidencia;
  ALTER TABLE evidencia_nova RENAME TO evidencia;`,
  // A IA externa (ator `externo`) registra a necessidade pelo `fabriquinha necessidade`: ela é a origem do ticket de
  // registro e o ator dos comandos dela. O CHECK de `origem` e o de `ator` não se alteram no SQLite, então `ticket` e
  // `comando` são recriadas (tabela nova, cópia, DROP, RENAME), com os índices de antes.
  `CREATE TABLE ticket_novo (
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
    enviado_em      TEXT CHECK (enviado_em IS NULL OR etapa IN ('registro','desenho')),
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
  CREATE TABLE comando_novo (
    id    INTEGER PRIMARY KEY,
    issue INTEGER NOT NULL REFERENCES issue(id),
    nome  TEXT    NOT NULL,
    ator  TEXT    NOT NULL CHECK (ator IN (${listaSql(TipoAtor)})),
    fase  TEXT    NOT NULL CHECK (fase IN (${listaSql(Fase)})),
    em    TEXT    NOT NULL
  );
  INSERT INTO comando_novo SELECT * FROM comando;
  DROP TABLE comando;
  ALTER TABLE comando_novo RENAME TO comando;`,
  // A reprovação de testes, fitness, SonarQube ou hooks devolve o ticket ao agente (devolverTicket) até um limite de
  // devoluções seguidas, que o C9 do Auditor zera.
  "ALTER TABLE ticket ADD COLUMN devolucoes INTEGER CHECK (devolucoes > 0);",
  `ALTER TABLE projeto ADD COLUMN efforts TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(efforts));`,
  // O modelo da Auditoria do Histórico, global (não pertence a nenhum projeto): nulo, usa o padrão do pi.
  `ALTER TABLE configuracao ADD COLUMN auditoria_provedor TEXT;
  ALTER TABLE configuracao ADD COLUMN auditoria_modelo TEXT CHECK ((auditoria_provedor IS NULL) = (auditoria_modelo IS NULL));`,
  // Iterações humanas (F6 §7): cada mensagem do Auditor ao agente, resposta a diálogo ou reabertura C9. Sem backfill.
  `CREATE TABLE iteracao (
    id     INTEGER PRIMARY KEY,
    ticket INTEGER NOT NULL REFERENCES ticket(id),
    tipo   TEXT NOT NULL CHECK (tipo IN ('mensagem','dialogo','reabertura')),
    em     TEXT NOT NULL
  );`,
  // Configuração SDLC do projeto (comparacao-sdlc §7.1), aditiva: as colunas legadas seguem valendo e não há backfill.
  // A ordem dos arrays vem das chaves (sem coluna de posição); os mínimos de filhos ficam no schema de domínio.
  `ALTER TABLE projeto ADD COLUMN cursor_commit_humano TEXT CHECK (cursor_commit_humano IS NULL OR length(cursor_commit_humano) > 0);
  CREATE TABLE configuracao_etapa_projeto (
    projeto         TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    etapa           TEXT NOT NULL CHECK (etapa IN (${listaSql(EtapaTicket)})),
    modelo_provedor TEXT CHECK (modelo_provedor IS NULL OR length(modelo_provedor) > 0),
    modelo_nome     TEXT CHECK (modelo_nome IS NULL OR length(modelo_nome) > 0),
    effort          TEXT CHECK (effort IS NULL OR effort IN (${listaSql(Effort)})),
    PRIMARY KEY (projeto, etapa),
    CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
  );
  CREATE TABLE comando_preparacao_projeto (
    projeto TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    ordem   INTEGER NOT NULL CHECK (typeof(ordem) = 'integer' AND ordem > 0),
    comando TEXT NOT NULL CHECK (length(comando) > 0),
    PRIMARY KEY (projeto, ordem)
  );
  CREATE TABLE fitness_function_projeto (
    projeto   TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    nome      TEXT NOT NULL CHECK (length(nome) > 0),
    comando   TEXT NOT NULL CHECK (length(comando) > 0),
    descricao TEXT NOT NULL CHECK (length(descricao) > 0),
    PRIMARY KEY (projeto, nome)
  );
  CREATE TABLE linguagem_projeto (
    projeto        TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    caminho        TEXT NOT NULL CHECK (length(caminho) > 0),
    linguagem      TEXT NOT NULL CHECK (length(linguagem) > 0),
    comando_teste  TEXT NOT NULL CHECK (length(comando_teste) > 0),
    PRIMARY KEY (projeto, caminho)
  );
  CREATE TABLE configuracao_e2e (
    projeto           TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    caminho_linguagem TEXT NOT NULL,
    comando_build     TEXT NOT NULL CHECK (length(comando_build) > 0),
    comando_execucao  TEXT NOT NULL CHECK (length(comando_execucao) > 0),
    codigo_falha      INTEGER NOT NULL CHECK (typeof(codigo_falha) = 'integer' AND codigo_falha BETWEEN 1 AND 255),
    PRIMARY KEY (projeto, caminho_linguagem),
    FOREIGN KEY (projeto, caminho_linguagem) REFERENCES linguagem_projeto(projeto, caminho) ON DELETE CASCADE
  );
  CREATE TABLE glob_e2e (
    projeto           TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    caminho_linguagem TEXT NOT NULL,
    glob              TEXT NOT NULL CHECK (length(glob) > 0),
    PRIMARY KEY (projeto, caminho_linguagem, glob),
    FOREIGN KEY (projeto, caminho_linguagem) REFERENCES configuracao_e2e(projeto, caminho_linguagem) ON DELETE CASCADE
  );`,
  // Agregado da demanda SDLC (comparacao-sdlc §7.2 e §7.4), aditivo: o legado segue intacto e sem backfill. Toda FK de
  // rodada ou ticket leva `demanda_id`; o banco garante autorreferência, FK e mesma rodada, mas não ciclo (isso é do domínio).
  `CREATE TABLE demanda (
    id                TEXT PRIMARY KEY,
    projeto           TEXT NOT NULL REFERENCES projeto(nome),
    titulo            TEXT NOT NULL,
    tipo              TEXT NOT NULL CHECK (tipo IN (${listaSql(TipoIssue)})),
    descricao         TEXT NOT NULL,
    fase              TEXT NOT NULL CHECK (fase IN (${listaSql(FaseDemanda)})),
    fase_alterada_em  TEXT NOT NULL,
    origem_ferramenta TEXT NOT NULL,
    origem_sessao     TEXT NOT NULL,
    enviada           INTEGER NOT NULL CHECK (enviada IN (0,1)),
    branch            TEXT NOT NULL
  );
  CREATE TABLE rodada (
    demanda_id TEXT NOT NULL REFERENCES demanda(id),
    rodada_id  INTEGER NOT NULL,
    titulo     TEXT NOT NULL,
    fase       TEXT NOT NULL CHECK (fase IN (${listaSql(FaseRodada)})),
    e2e        INTEGER NOT NULL CHECK (e2e IN (0,1)),
    branch     TEXT NOT NULL,
    PRIMARY KEY (demanda_id, rodada_id)
  );
  CREATE TABLE dependencia_rodada (
    demanda_id        TEXT NOT NULL,
    rodada_id         INTEGER NOT NULL,
    depende_rodada_id INTEGER NOT NULL,
    PRIMARY KEY (demanda_id, rodada_id, depende_rodada_id),
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id),
    FOREIGN KEY (demanda_id, depende_rodada_id) REFERENCES rodada(demanda_id, rodada_id),
    CHECK (rodada_id <> depende_rodada_id)
  );
  CREATE TABLE criterio_citado_rodada (
    demanda_id  TEXT NOT NULL,
    rodada_id   INTEGER NOT NULL,
    criterio_id TEXT NOT NULL,
    PRIMARY KEY (demanda_id, rodada_id, criterio_id),
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id)
  );
  CREATE TABLE ticket_demanda (
    demanda_id         TEXT NOT NULL REFERENCES demanda(id),
    ticket_id          INTEGER NOT NULL,
    etapa              TEXT NOT NULL CHECK (etapa IN (${listaSql(EtapaTicket)})),
    status             TEXT NOT NULL CHECK (status IN (${listaSql(StatusTicket)})),
    status_alterado_em TEXT NOT NULL,
    rodada_id          INTEGER,
    titulo             TEXT,
    descricao          TEXT,
    modelo_provedor    TEXT,
    modelo_nome        TEXT,
    effort             TEXT CHECK (effort IS NULL OR effort IN (${listaSql(Effort)})),
    instrucao          TEXT,
    PRIMARY KEY (demanda_id, ticket_id),
    UNIQUE (demanda_id, ticket_id, rodada_id),
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id),
    CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
  );
  -- rodada_id derivada e NOT NULL: sem rodada (ticket de demanda) ou rodadas diferentes, a FK composta recusa.
  CREATE TABLE dependencia_ticket (
    demanda_id        TEXT NOT NULL,
    ticket_id         INTEGER NOT NULL,
    depende_ticket_id INTEGER NOT NULL,
    rodada_id         INTEGER NOT NULL,
    PRIMARY KEY (demanda_id, ticket_id, depende_ticket_id),
    FOREIGN KEY (demanda_id, ticket_id, rodada_id) REFERENCES ticket_demanda(demanda_id, ticket_id, rodada_id),
    FOREIGN KEY (demanda_id, depende_ticket_id, rodada_id) REFERENCES ticket_demanda(demanda_id, ticket_id, rodada_id),
    CHECK (ticket_id <> depende_ticket_id)
  );
  CREATE TABLE caminho_ticket (
    demanda_id TEXT NOT NULL,
    ticket_id  INTEGER NOT NULL,
    caminho    TEXT NOT NULL,
    PRIMARY KEY (demanda_id, ticket_id, caminho),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id)
  );
  CREATE TABLE decisao_ticket (
    demanda_id TEXT NOT NULL,
    ticket_id  INTEGER NOT NULL,
    decisao_id INTEGER NOT NULL,
    resultado  TEXT NOT NULL CHECK (resultado IN ('aprovado','recusado')),
    nota       INTEGER CHECK (nota BETWEEN 1 AND 5),
    motivo     TEXT,
    por        TEXT NOT NULL CHECK (por IN ('auditor','agente')),
    em         TEXT NOT NULL,
    PRIMARY KEY (demanda_id, ticket_id, decisao_id),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id)
  );
  CREATE TABLE evidencia_demanda (
    id         TEXT PRIMARY KEY,
    demanda_id TEXT NOT NULL REFERENCES demanda(id),
    rodada_id  INTEGER,
    ticket_id  INTEGER,
    tipo       TEXT NOT NULL CHECK (tipo IN (${listaSql(TIPOS_EVIDENCIA_MIGRACAO_24)})),
    dados      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dados)),
    em         TEXT NOT NULL,
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    CHECK (rodada_id IS NULL OR ticket_id IS NULL)
  );
  -- Nova submissão do mesmo tipo pelo mesmo dono substitui a anterior; um índice por dono.
  CREATE UNIQUE INDEX ux_evidencia_demanda_demanda ON evidencia_demanda(demanda_id, tipo) WHERE rodada_id IS NULL AND ticket_id IS NULL;
  CREATE UNIQUE INDEX ux_evidencia_demanda_rodada ON evidencia_demanda(demanda_id, rodada_id, tipo) WHERE rodada_id IS NOT NULL;
  CREATE UNIQUE INDEX ux_evidencia_demanda_ticket ON evidencia_demanda(demanda_id, ticket_id, tipo) WHERE ticket_id IS NOT NULL;`,
  // Progresso do encerramento e sessões (comparacao-sdlc §5 e §7.3), aditivo: sem backfill e sem tocar nas tabelas legadas.
  `CREATE TABLE encerramento_demanda (
    demanda_id        TEXT PRIMARY KEY REFERENCES demanda(id),
    pr_numero         INTEGER CHECK (pr_numero IS NULL OR (typeof(pr_numero) = 'integer' AND pr_numero > 0)),
    pr_url            TEXT CHECK (pr_url IS NULL OR length(pr_url) > 0),
    branch            TEXT NOT NULL,
    base              TEXT NOT NULL CHECK (length(base) > 0),
    sha_verificado    TEXT CHECK (sha_verificado IS NULL OR length(sha_verificado) > 0),
    integracao_sha    TEXT CHECK (integracao_sha IS NULL OR length(integracao_sha) > 0),
    conflito_ticket_id INTEGER,
    falha_etapa       TEXT CHECK (falha_etapa IS NULL OR falha_etapa IN (${listaSql(ProgressoEncerramento.shape.falha.unwrap().shape.etapa)})),
    falha_motivo      TEXT CHECK (falha_motivo IS NULL OR length(falha_motivo) > 0),
    FOREIGN KEY (demanda_id, conflito_ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    CHECK ((pr_numero IS NULL) = (pr_url IS NULL)),
    CHECK (integracao_sha IS NULL OR pr_numero IS NOT NULL),
    CHECK ((falha_etapa IS NULL) = (falha_motivo IS NULL))
  );
  CREATE TABLE limpeza_pendente_encerramento (
    demanda_id       TEXT NOT NULL REFERENCES encerramento_demanda(demanda_id),
    limpeza_pendente TEXT NOT NULL CHECK (length(limpeza_pendente) > 0),
    PRIMARY KEY (demanda_id, limpeza_pendente)
  );
  CREATE TABLE sessao (
    id                  TEXT PRIMARY KEY CHECK (length(id) > 0),
    demanda_id          TEXT NOT NULL,
    ticket_id           INTEGER NOT NULL,
    modo                TEXT NOT NULL CHECK (modo IN (${listaSql(ModoExecucao)})),
    conversa_referencia TEXT NOT NULL CHECK (length(conversa_referencia) > 0),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id)
  );
  CREATE INDEX ix_sessao_ticket ON sessao(demanda_id, ticket_id);
  CREATE TABLE execucao_sessao (
    id        TEXT PRIMARY KEY CHECK (length(id) > 0),
    sessao_id TEXT NOT NULL REFERENCES sessao(id),
    inicio    TEXT NOT NULL,
    fim       TEXT,
    falha     INTEGER NOT NULL CHECK (falha IN (0,1))
  );
  CREATE INDEX ix_execucao_sessao_sessao ON execucao_sessao(sessao_id);
  CREATE TABLE uso_modelo_execucao (
    execucao_id          TEXT NOT NULL REFERENCES execucao_sessao(id),
    modelo_provedor      TEXT NOT NULL CHECK (length(modelo_provedor) > 0),
    modelo_nome          TEXT NOT NULL CHECK (length(modelo_nome) > 0),
    tokens_entrada       INTEGER NOT NULL CHECK (typeof(tokens_entrada) = 'integer' AND tokens_entrada >= 0),
    tokens_saida         INTEGER NOT NULL CHECK (typeof(tokens_saida) = 'integer' AND tokens_saida >= 0),
    tokens_cache_leitura INTEGER NOT NULL CHECK (typeof(tokens_cache_leitura) = 'integer' AND tokens_cache_leitura >= 0),
    tokens_cache_escrita INTEGER NOT NULL CHECK (typeof(tokens_cache_escrita) = 'integer' AND tokens_cache_escrita >= 0),
    custo                REAL CHECK (custo IS NULL OR custo >= 0),
    PRIMARY KEY (execucao_id, modelo_provedor, modelo_nome)
  );`,
  `ALTER TABLE ticket_demanda ADD COLUMN devolucoes INTEGER NOT NULL DEFAULT 0 CHECK (devolucoes BETWEEN 0 AND 2);
  ALTER TABLE ticket_demanda ADD COLUMN motivo_falha TEXT CHECK (motivo_falha IS NULL OR length(motivo_falha) > 0);`,
  // Dependência entre demandas (§7.2), aditiva: ciclo e "enviada" são do domínio; o banco garante FK, PK e autorreferência.
  `CREATE TABLE dependencia_demanda (
    demanda_id         TEXT NOT NULL REFERENCES demanda(id),
    depende_demanda_id TEXT NOT NULL REFERENCES demanda(id),
    PRIMARY KEY (demanda_id, depende_demanda_id),
    CHECK (demanda_id <> depende_demanda_id)
  );`,
  // Controle da execução de sessão e limite global de paralelismo (D04), aditivo: sem backfill.
  `ALTER TABLE execucao_sessao ADD COLUMN grupo_processo INTEGER CHECK (grupo_processo IS NULL OR (typeof(grupo_processo) = 'integer' AND grupo_processo > 0));
  ALTER TABLE execucao_sessao ADD COLUMN erro TEXT CHECK (erro IS NULL OR length(erro) > 0);
  ALTER TABLE execucao_sessao ADD COLUMN modelo_provedor TEXT CHECK (modelo_provedor IS NULL OR length(modelo_provedor) > 0);
  ALTER TABLE execucao_sessao ADD COLUMN modelo_nome TEXT CHECK (modelo_nome IS NULL OR length(modelo_nome) > 0) CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL));
  ALTER TABLE execucao_sessao ADD COLUMN effort TEXT CHECK (effort IS NULL OR effort IN (${listaSql(Effort)}));
  ALTER TABLE configuracao ADD COLUMN limite_paralelismo INTEGER NOT NULL DEFAULT 4 CHECK (typeof(limite_paralelismo) = 'integer' AND limite_paralelismo > 0);`,
  // Commit, arquivos e retrabalho do ticket da demanda (§8, §10.1), aditivo: convive com as tabelas legadas, sem backfill.
  `CREATE TABLE commit_ticket_demanda (
    sha        TEXT PRIMARY KEY CHECK (length(sha) IN (40, 64)),
    demanda_id TEXT NOT NULL,
    ticket_id  INTEGER NOT NULL,
    mensagem   TEXT NOT NULL,
    em         TEXT NOT NULL,
    UNIQUE (demanda_id, ticket_id),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id)
  );
  CREATE TABLE arquivo_commit_demanda (
    sha              TEXT NOT NULL REFERENCES commit_ticket_demanda(sha),
    caminho          TEXT NOT NULL,
    caminho_anterior TEXT,
    status           TEXT NOT NULL CHECK (status IN (${listaSql(StatusArquivo)})),
    adicionadas      INTEGER CHECK (adicionadas >= 0),
    removidas        INTEGER CHECK (removidas >= 0),
    PRIMARY KEY (sha, caminho),
    CHECK ((status = 'R') = (caminho_anterior IS NOT NULL))
  );
  CREATE INDEX ix_arquivo_commit_demanda_caminho ON arquivo_commit_demanda(caminho);
  CREATE TABLE retrabalho_demanda (
    commit_alterador TEXT    NOT NULL,
    demanda_id       TEXT    NOT NULL,
    ticket_id        INTEGER,
    autor            TEXT,
    ticket_origem_id INTEGER NOT NULL,
    linhas           INTEGER NOT NULL CHECK (linhas >= 1),
    PRIMARY KEY (commit_alterador, demanda_id, ticket_origem_id),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    FOREIGN KEY (demanda_id, ticket_origem_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    CHECK (ticket_id IS NULL OR ticket_id <> ticket_origem_id),
    CHECK ((ticket_id IS NULL) = (autor IS NOT NULL))
  );
  CREATE INDEX ix_retrabalho_demanda_origem ON retrabalho_demanda(demanda_id, ticket_origem_id);
  CREATE INDEX ix_retrabalho_demanda_alterador ON retrabalho_demanda(demanda_id, ticket_id);`,
  // Anexos e sessões externas da evidência da demanda (D10) e tipos de etapa novos no CHECK: recria evidencia_demanda preservando linhas.
  `CREATE TABLE evidencia_demanda_nova (
    id         TEXT PRIMARY KEY,
    demanda_id TEXT NOT NULL REFERENCES demanda(id),
    rodada_id  INTEGER,
    ticket_id  INTEGER,
    tipo       TEXT NOT NULL CHECK (tipo IN (${listaSql(TipoEvidenciaAgregado)})),
    dados      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dados)),
    em         TEXT NOT NULL,
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    CHECK (rodada_id IS NULL OR ticket_id IS NULL)
  );
  INSERT INTO evidencia_demanda_nova SELECT id, demanda_id, rodada_id, ticket_id, tipo, dados, em FROM evidencia_demanda ORDER BY rowid;
  DROP TABLE evidencia_demanda;
  ALTER TABLE evidencia_demanda_nova RENAME TO evidencia_demanda;
  CREATE UNIQUE INDEX ux_evidencia_demanda_demanda ON evidencia_demanda(demanda_id, tipo) WHERE rodada_id IS NULL AND ticket_id IS NULL;
  CREATE UNIQUE INDEX ux_evidencia_demanda_rodada ON evidencia_demanda(demanda_id, rodada_id, tipo) WHERE rodada_id IS NOT NULL;
  CREATE UNIQUE INDEX ux_evidencia_demanda_ticket ON evidencia_demanda(demanda_id, ticket_id, tipo) WHERE ticket_id IS NOT NULL;
  CREATE TABLE arquivo_evidencia (
    evidencia_id TEXT NOT NULL REFERENCES evidencia_demanda(id) ON DELETE CASCADE,
    ordem        INTEGER NOT NULL CHECK (ordem >= 1),
    caminho      TEXT NOT NULL,
    sha256       TEXT NOT NULL,
    mime         TEXT NOT NULL,
    bytes        INTEGER NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (evidencia_id, ordem)
  );
  CREATE TABLE sessao_externa_demanda (
    ferramenta TEXT NOT NULL,
    sessao     TEXT NOT NULL,
    demanda_id TEXT NOT NULL REFERENCES demanda(id),
    PRIMARY KEY (ferramenta, sessao)
  );`,
  // Histórico legado que o ERD não tem (§10.1) e alterador do retrabalho de outra demanda: aditivo; recria retrabalho_demanda preservando linhas.
  `ALTER TABLE ticket_demanda ADD COLUMN criado_em TEXT;
  ALTER TABLE ticket_demanda ADD COLUMN concluido_em TEXT;
  ALTER TABLE ticket_demanda ADD COLUMN enviado_em TEXT;
  ALTER TABLE ticket_demanda ADD COLUMN origem TEXT CHECK (origem IS NULL OR origem IN (${listaSql(TipoAtor)}));
  ALTER TABLE ticket_demanda ADD COLUMN origem_ticket_id INTEGER;
  CREATE TABLE demanda_historico (
    demanda_id   TEXT PRIMARY KEY REFERENCES demanda(id),
    criada_em    TEXT NOT NULL,
    concluida_em TEXT,
    cancelada_em TEXT,
    arquivada_em TEXT
  );
  CREATE TABLE decisao_ticket_historico (
    demanda_id TEXT NOT NULL,
    ticket_id  INTEGER NOT NULL,
    decisao_id INTEGER NOT NULL,
    gate       TEXT NOT NULL CHECK (gate IN (${listaSql(GateDecisao)})),
    PRIMARY KEY (demanda_id, ticket_id, decisao_id),
    FOREIGN KEY (demanda_id, ticket_id, decisao_id) REFERENCES decisao_ticket(demanda_id, ticket_id, decisao_id)
  );
  CREATE TABLE evidencia_historico (
    evidencia_id TEXT PRIMARY KEY REFERENCES evidencia_demanda(id) ON DELETE CASCADE,
    aprovada     INTEGER CHECK (aprovada IN (0, 1)),
    produtor     TEXT NOT NULL CHECK (produtor IN (${listaSql(Produtor)}))
  );
  CREATE TABLE uso_modelo_historico (
    execucao_id     TEXT NOT NULL,
    modelo_provedor TEXT NOT NULL,
    modelo_nome     TEXT NOT NULL,
    chamadas        INTEGER NOT NULL CHECK (chamadas >= 1),
    PRIMARY KEY (execucao_id, modelo_provedor, modelo_nome),
    FOREIGN KEY (execucao_id, modelo_provedor, modelo_nome) REFERENCES uso_modelo_execucao(execucao_id, modelo_provedor, modelo_nome)
  );
  CREATE TABLE retrabalho_demanda_nova (
    commit_alterador     TEXT    NOT NULL,
    demanda_id           TEXT    NOT NULL,
    ticket_id            INTEGER,
    autor                TEXT,
    ticket_origem_id     INTEGER NOT NULL,
    linhas               INTEGER NOT NULL CHECK (linhas >= 1),
    alterador_demanda_id TEXT,
    PRIMARY KEY (commit_alterador, demanda_id, ticket_origem_id),
    FOREIGN KEY (alterador_demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    FOREIGN KEY (demanda_id, ticket_origem_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    CHECK ((ticket_id IS NULL) = (autor IS NOT NULL)),
    CHECK ((ticket_id IS NULL) = (alterador_demanda_id IS NULL)),
    CHECK (alterador_demanda_id IS NULL OR alterador_demanda_id <> demanda_id OR ticket_id <> ticket_origem_id)
  );
  INSERT INTO retrabalho_demanda_nova
    SELECT commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas,
           CASE WHEN ticket_id IS NULL THEN NULL ELSE demanda_id END
    FROM retrabalho_demanda ORDER BY rowid;
  DROP TABLE retrabalho_demanda;
  ALTER TABLE retrabalho_demanda_nova RENAME TO retrabalho_demanda;
  CREATE INDEX ix_retrabalho_demanda_origem ON retrabalho_demanda(demanda_id, ticket_origem_id);
  CREATE INDEX ix_retrabalho_demanda_alterador ON retrabalho_demanda(alterador_demanda_id, ticket_id);`,
  // Avaliação de melhoria do SDLC sobre demandas (D12), aditiva: o achado encaminhado liga-se à demanda criada, uma só vez.
  `CREATE TABLE avaliacao (
    id        TEXT PRIMARY KEY CHECK (length(id) > 0),
    projeto   TEXT NOT NULL REFERENCES projeto(nome),
    de        TEXT NOT NULL CHECK (de GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    ate       TEXT NOT NULL CHECK (ate GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND ate >= de),
    pedido    TEXT NOT NULL,
    criada_em TEXT NOT NULL
  );
  CREATE TABLE avaliacao_demanda (
    avaliacao_id TEXT NOT NULL REFERENCES avaliacao(id),
    demanda_id   TEXT NOT NULL REFERENCES demanda(id),
    PRIMARY KEY (avaliacao_id, demanda_id)
  );
  CREATE TABLE achado_avaliacao (
    avaliacao_id TEXT NOT NULL REFERENCES avaliacao(id),
    achado_id    INTEGER NOT NULL CHECK (achado_id >= 1),
    titulo       TEXT NOT NULL CHECK (length(titulo) > 0),
    descricao    TEXT NOT NULL CHECK (length(descricao) > 0),
    evidencia    TEXT NOT NULL CHECK (length(evidencia) > 0),
    demanda_id   TEXT REFERENCES demanda(id),
    PRIMARY KEY (avaliacao_id, achado_id)
  );
  CREATE UNIQUE INDEX ux_achado_avaliacao_demanda ON achado_avaliacao(demanda_id) WHERE demanda_id IS NOT NULL;
  CREATE TABLE uso_avaliacao (
    avaliacao_id         TEXT NOT NULL REFERENCES avaliacao(id),
    modelo_provedor      TEXT NOT NULL CHECK (length(modelo_provedor) > 0),
    modelo_nome          TEXT NOT NULL CHECK (length(modelo_nome) > 0),
    chamadas             INTEGER NOT NULL CHECK (typeof(chamadas) = 'integer' AND chamadas >= 0),
    tokens_entrada       INTEGER NOT NULL CHECK (typeof(tokens_entrada) = 'integer' AND tokens_entrada >= 0),
    tokens_saida         INTEGER NOT NULL CHECK (typeof(tokens_saida) = 'integer' AND tokens_saida >= 0),
    tokens_cache_leitura INTEGER NOT NULL CHECK (typeof(tokens_cache_leitura) = 'integer' AND tokens_cache_leitura >= 0),
    tokens_cache_escrita INTEGER NOT NULL CHECK (typeof(tokens_cache_escrita) = 'integer' AND tokens_cache_escrita >= 0),
    custo                REAL CHECK (custo IS NULL OR custo >= 0),
    PRIMARY KEY (avaliacao_id, modelo_provedor, modelo_nome)
  );`,
  removerFluxoLegado,
];

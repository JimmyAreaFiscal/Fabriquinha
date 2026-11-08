// Migrações do banco (F2 §3.7): a posição na lista + 36 é a versão gravada em `PRAGMA user_version`.
// As migrações 1 a 36 viraram a linha de base `ESQUEMA_V36`; só se acrescenta ao fim de `MIGRACOES` (a primeira é a 37),
// e migração já aplicada não muda.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../nucleo/erros.ts";

/** Versão do banco que a linha de base entrega: a última migração que a cadeia antiga aplicava. */
export const VERSAO_LINHA_DE_BASE = 36;

/** Uma migração é SQL ou, quando precisa conferir algo e recusar com orientação, uma função; roda na transação do `migrar`. */
export type Migracao = string | ((banco: DatabaseSync) => void);

/**
 * O esquema da v36, gerado uma vez do `sqlite_master` de um banco criado pela cadeia 1-36 (tabelas, índices e CHECK
 * idênticos), mais a linha única de `configuracao`. Banco vazio nasce daqui.
 */
export const ESQUEMA_V36 = `
CREATE TABLE projeto (
    nome              TEXT PRIMARY KEY CHECK (length(nome) BETWEEN 1 AND 64),
    repo              TEXT NOT NULL UNIQUE,
    branch_base       TEXT NOT NULL,
    hospedagem        TEXT NOT NULL CHECK (hospedagem IN ('github','azure-devops')),
    sonar_project_key TEXT NOT NULL,
    link_produto TEXT, cursor_commit_humano TEXT CHECK (cursor_commit_humano IS NULL OR length(cursor_commit_humano) > 0));
CREATE TABLE configuracao (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    agendador_ativo  INTEGER NOT NULL DEFAULT 0 CHECK (agendador_ativo IN (0,1)),
    intervalo_min    INTEGER NOT NULL DEFAULT 5   CHECK (intervalo_min BETWEEN 1 AND 1440),
    timeout_min      INTEGER NOT NULL DEFAULT 120 CHECK (timeout_min BETWEEN 10 AND 1440),
    ociosidade_min   INTEGER NOT NULL DEFAULT 30  CHECK (ociosidade_min BETWEEN 5 AND 1440)
  , auditoria_provedor TEXT, auditoria_modelo TEXT CHECK ((auditoria_provedor IS NULL) = (auditoria_modelo IS NULL)), limite_paralelismo INTEGER NOT NULL DEFAULT 4 CHECK (typeof(limite_paralelismo) = 'integer' AND limite_paralelismo > 0));
CREATE TABLE varredura_base (
    projeto    TEXT PRIMARY KEY REFERENCES projeto(nome),
    ultimo_sha TEXT NOT NULL CHECK (length(ultimo_sha) IN (40, 64)),
    em         TEXT NOT NULL
  );
CREATE TABLE usuario_simulado (
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
  );
CREATE TABLE tarefa (
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
  );
CREATE TABLE execucao_simulada (
    id           INTEGER PRIMARY KEY,
    tarefa       INTEGER NOT NULL REFERENCES tarefa(id),
    usuario      INTEGER NOT NULL REFERENCES usuario_simulado(id),
    status       TEXT NOT NULL CHECK (status IN ('na_fila','em_andamento','concluida','falhou')),
    relatorio    TEXT CHECK (relatorio IS NULL OR json_valid(relatorio)),
    erro         TEXT,
    pgid         INTEGER,
    iniciada_em  TEXT,
    terminada_em TEXT,
    CHECK ((status = 'falhou') = (erro IS NOT NULL)),
    CHECK ((status = 'concluida') = (relatorio IS NOT NULL))
  );
CREATE INDEX ix_execucao_simulada_tarefa ON execucao_simulada(tarefa);
CREATE INDEX ix_execucao_simulada_pendente ON execucao_simulada(tarefa) WHERE status IN ('na_fila', 'em_andamento');
CREATE TABLE "sequencia" (
    nome  TEXT PRIMARY KEY CHECK (nome IN ('issue','ticket','execucao','decisao','evidencia','proposta')),
    valor INTEGER NOT NULL CHECK (valor >= 0)
  );
CREATE TABLE configuracao_etapa_projeto (
    projeto         TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    etapa           TEXT NOT NULL CHECK (etapa IN ('demanda','planejar','implementar','revisar_rodada','encerrar_rodada','sessao_em_aberto','revisar_demanda','encerrar_demanda','resolver_conflito')),
    modelo_provedor TEXT CHECK (modelo_provedor IS NULL OR length(modelo_provedor) > 0),
    modelo_nome     TEXT CHECK (modelo_nome IS NULL OR length(modelo_nome) > 0),
    effort          TEXT CHECK (effort IS NULL OR effort IN ('off','minimal','low','medium','high','xhigh','max')),
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
  );
CREATE TABLE demanda (
    id                TEXT PRIMARY KEY,
    projeto           TEXT NOT NULL REFERENCES projeto(nome),
    titulo            TEXT NOT NULL,
    tipo              TEXT NOT NULL CHECK (tipo IN ('funcionalidade','problema')),
    descricao         TEXT NOT NULL,
    fase              TEXT NOT NULL CHECK (fase IN ('registro','aprovacao_demanda','planejamento','aprovacao_planejamento','execucao','revisao_demanda','encerramento','concluida','arquivada','cancelada')),
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
    fase       TEXT NOT NULL CHECK (fase IN ('desenvolvimento','revisao','encerramento','aprovacao_pull_request','sessao','concluida')),
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
    etapa              TEXT NOT NULL CHECK (etapa IN ('demanda','planejar','implementar','revisar_rodada','encerrar_rodada','sessao_em_aberto','revisar_demanda','encerrar_demanda','resolver_conflito')),
    status             TEXT NOT NULL CHECK (status IN ('aberto','em_execucao','concluido','falhou','fechado','cancelado')),
    status_alterado_em TEXT NOT NULL,
    rodada_id          INTEGER,
    titulo             TEXT,
    descricao          TEXT,
    modelo_provedor    TEXT,
    modelo_nome        TEXT,
    effort             TEXT CHECK (effort IS NULL OR effort IN ('off','minimal','low','medium','high','xhigh','max')),
    instrucao          TEXT, devolucoes INTEGER NOT NULL DEFAULT 0 CHECK (devolucoes BETWEEN 0 AND 2), motivo_falha TEXT CHECK (motivo_falha IS NULL OR length(motivo_falha) > 0), criado_em TEXT, concluido_em TEXT, enviado_em TEXT, origem TEXT CHECK (origem IS NULL OR origem IN ('auditor','agente','fabriquinha','externo')), origem_ticket_id INTEGER, retomadas_automaticas INTEGER NOT NULL DEFAULT 0 CHECK (retomadas_automaticas >= 0),
    PRIMARY KEY (demanda_id, ticket_id),
    UNIQUE (demanda_id, ticket_id, rodada_id),
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id),
    CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
  );
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
CREATE TABLE encerramento_demanda (
    demanda_id        TEXT PRIMARY KEY REFERENCES demanda(id),
    pr_numero         INTEGER CHECK (pr_numero IS NULL OR (typeof(pr_numero) = 'integer' AND pr_numero > 0)),
    pr_url            TEXT CHECK (pr_url IS NULL OR length(pr_url) > 0),
    branch            TEXT NOT NULL,
    base              TEXT NOT NULL CHECK (length(base) > 0),
    sha_verificado    TEXT CHECK (sha_verificado IS NULL OR length(sha_verificado) > 0),
    integracao_sha    TEXT CHECK (integracao_sha IS NULL OR length(integracao_sha) > 0),
    conflito_ticket_id INTEGER,
    falha_etapa       TEXT CHECK (falha_etapa IS NULL OR falha_etapa IN ('check_final','integracao','limpeza')),
    falha_motivo      TEXT CHECK (falha_motivo IS NULL OR length(falha_motivo) > 0), aguardando_merge_humano INTEGER NOT NULL DEFAULT 0 CHECK (aguardando_merge_humano IN (0, 1)),
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
    modo                TEXT NOT NULL CHECK (modo IN ('autonomo','interativo','consulta')),
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
  , grupo_processo INTEGER CHECK (grupo_processo IS NULL OR (typeof(grupo_processo) = 'integer' AND grupo_processo > 0)), erro TEXT CHECK (erro IS NULL OR length(erro) > 0), modelo_provedor TEXT CHECK (modelo_provedor IS NULL OR length(modelo_provedor) > 0), modelo_nome TEXT CHECK (modelo_nome IS NULL OR length(modelo_nome) > 0) CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL)), effort TEXT CHECK (effort IS NULL OR effort IN ('off','minimal','low','medium','high','xhigh','max')));
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
  );
CREATE TABLE dependencia_demanda (
    demanda_id         TEXT NOT NULL REFERENCES demanda(id),
    depende_demanda_id TEXT NOT NULL REFERENCES demanda(id),
    PRIMARY KEY (demanda_id, depende_demanda_id),
    CHECK (demanda_id <> depende_demanda_id)
  );
CREATE TABLE commit_ticket_demanda (
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
    status           TEXT NOT NULL CHECK (status IN ('A','M','D','R')),
    adicionadas      INTEGER CHECK (adicionadas >= 0),
    removidas        INTEGER CHECK (removidas >= 0),
    PRIMARY KEY (sha, caminho),
    CHECK ((status = 'R') = (caminho_anterior IS NOT NULL))
  );
CREATE INDEX ix_arquivo_commit_demanda_caminho ON arquivo_commit_demanda(caminho);
CREATE TABLE "evidencia_demanda" (
    id         TEXT PRIMARY KEY,
    demanda_id TEXT NOT NULL REFERENCES demanda(id),
    rodada_id  INTEGER,
    ticket_id  INTEGER,
    tipo       TEXT NOT NULL CHECK (tipo IN ('comportamento','criterios_aceite','desenho_solucao','prototipo','relatorio_complexidade','relatorio_impactos_arquitetura','execucao_testes','matriz_fitness','relatorio_sonar','arquivos_alterados','explicacao_fitness','comprovacao_criterios','mensagem_pr','aula_codigo','video_demonstracao','relatorio_produtividade','pr_aberto','custos_realizados','plano','testes_estresse','analise_seguranca','arvore_prs_criterios_custos','demonstracao_limpeza')),
    dados      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dados)),
    em         TEXT NOT NULL,
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    CHECK (rodada_id IS NULL OR ticket_id IS NULL)
  );
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
  );
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
    gate       TEXT NOT NULL CHECK (gate IN ('registro','desenho','revisao','pr')),
    PRIMARY KEY (demanda_id, ticket_id, decisao_id),
    FOREIGN KEY (demanda_id, ticket_id, decisao_id) REFERENCES decisao_ticket(demanda_id, ticket_id, decisao_id)
  );
CREATE TABLE evidencia_historico (
    evidencia_id TEXT PRIMARY KEY REFERENCES evidencia_demanda(id) ON DELETE CASCADE,
    aprovada     INTEGER CHECK (aprovada IN (0, 1)),
    produtor     TEXT NOT NULL CHECK (produtor IN ('agente','fabriquinha'))
  );
CREATE TABLE uso_modelo_historico (
    execucao_id     TEXT NOT NULL,
    modelo_provedor TEXT NOT NULL,
    modelo_nome     TEXT NOT NULL,
    chamadas        INTEGER NOT NULL CHECK (chamadas >= 1),
    PRIMARY KEY (execucao_id, modelo_provedor, modelo_nome),
    FOREIGN KEY (execucao_id, modelo_provedor, modelo_nome) REFERENCES uso_modelo_execucao(execucao_id, modelo_provedor, modelo_nome)
  );
CREATE TABLE "retrabalho_demanda" (
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
CREATE INDEX ix_retrabalho_demanda_origem ON retrabalho_demanda(demanda_id, ticket_origem_id);
CREATE INDEX ix_retrabalho_demanda_alterador ON retrabalho_demanda(alterador_demanda_id, ticket_id);
CREATE TABLE avaliacao (
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
  );
CREATE TABLE iteracao_demanda (
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
INSERT INTO configuracao (id) VALUES (1);
`;

/**
 * A 37 grava a autoria (o `Ator`) nas colunas. `criado_por_tipo` e `autor_tipo` nascem 'fabriquinha' por DEFAULT: os
 * tickets e as evidências já gravados e os novos, até quem grava passar a informar o ator. Em `decisao_ticket` o
 * `por_trabalho_id` só é NULL nas linhas de antes da migração em que o ticket não tinha execução, e em decisão nova
 * enquanto o domínio não informar o trabalho. `trabalho_id` é o `execucao_sessao.id`, sem FK: o Trabalho Agêntico vem depois.
 */
const MIGRACAO_37_AUTORIA = `
ALTER TABLE ticket_demanda ADD COLUMN criado_por_tipo TEXT NOT NULL DEFAULT 'fabriquinha' CHECK (criado_por_tipo IN ('auditor','agente','fabriquinha','externo'));
ALTER TABLE ticket_demanda ADD COLUMN criado_por_trabalho_id TEXT CHECK ((criado_por_tipo = 'agente') = (criado_por_trabalho_id IS NOT NULL));
ALTER TABLE ticket_demanda DROP COLUMN origem;
ALTER TABLE demanda RENAME COLUMN origem_ferramenta TO criada_por_ferramenta;
ALTER TABLE demanda RENAME COLUMN origem_sessao TO criada_por_sessao;
CREATE TABLE decisao_ticket_nova (
    demanda_id      TEXT NOT NULL,
    ticket_id       INTEGER NOT NULL,
    decisao_id      INTEGER NOT NULL,
    resultado       TEXT NOT NULL CHECK (resultado IN ('aprovado','recusado')),
    nota            INTEGER CHECK (nota BETWEEN 1 AND 5),
    motivo          TEXT,
    por_tipo        TEXT NOT NULL CHECK (por_tipo IN ('auditor','agente','fabriquinha')),
    por_trabalho_id TEXT CHECK (por_trabalho_id IS NULL OR por_tipo = 'agente'),
    em              TEXT NOT NULL,
    PRIMARY KEY (demanda_id, ticket_id, decisao_id),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id)
  );
INSERT INTO decisao_ticket_nova
  SELECT d.demanda_id, d.ticket_id, d.decisao_id, d.resultado, d.nota, d.motivo, d.por,
         CASE d.por WHEN 'agente' THEN (
           SELECT e.id FROM execucao_sessao e JOIN sessao s ON s.id = e.sessao_id
           WHERE s.demanda_id = d.demanda_id AND s.ticket_id = d.ticket_id
           ORDER BY e.inicio DESC, e.rowid DESC LIMIT 1) END,
         d.em
  FROM decisao_ticket d ORDER BY d.rowid;
DROP TABLE decisao_ticket;
ALTER TABLE decisao_ticket_nova RENAME TO decisao_ticket;
ALTER TABLE evidencia_demanda ADD COLUMN autor_tipo TEXT NOT NULL DEFAULT 'fabriquinha' CHECK (autor_tipo IN ('auditor','agente','fabriquinha','externo'));
ALTER TABLE evidencia_demanda ADD COLUMN autor_trabalho_id TEXT CHECK ((autor_tipo = 'agente') = (autor_trabalho_id IS NOT NULL));
ALTER TABLE evidencia_demanda ADD COLUMN autor_ferramenta TEXT CHECK ((autor_tipo = 'externo') = (autor_ferramenta IS NOT NULL));
ALTER TABLE evidencia_demanda ADD COLUMN autor_sessao TEXT CHECK ((autor_tipo = 'externo') = (autor_sessao IS NOT NULL));
`;

/**
 * A 38 dá a Demanda, a Rodada e o Ticket um só vocabulário, o de estado: `fase` e `status` viram `estado`, e os valores
 * passam a ter o nome da Etapa. A Rodada ganha `estado_alterado_em` (o maior do ticket dela, ou o da demanda se não há
 * ticket); o ticket perde `enviado_em` e `origem_ticket_id`, que ninguém escreve nem lê, e troca `fechado` por `cancelado`;
 * a Etapa `demanda` vira `entender_e_desenhar` e `sessao_em_aberto`, `ajustar_resultado`; a sequência `issue`, `demanda`.
 * Cada tabela é recriada com o CHECK novo, e as linhas voltam na mesma ordem.
 */
const MIGRACAO_38_ESTADO = `
CREATE TABLE demanda_nova (
    id                TEXT PRIMARY KEY,
    projeto           TEXT NOT NULL REFERENCES projeto(nome),
    titulo            TEXT NOT NULL,
    tipo              TEXT NOT NULL CHECK (tipo IN ('funcionalidade','problema')),
    descricao         TEXT NOT NULL,
    estado            TEXT NOT NULL CHECK (estado IN ('entender_e_desenhar','gate_demanda','planejar','gate_planejamento','em_execucao','revisar_demanda','encerrar_demanda','concluida','arquivada','cancelada')),
    estado_alterado_em TEXT NOT NULL,
    criada_por_ferramenta TEXT NOT NULL,
    criada_por_sessao     TEXT NOT NULL,
    enviada           INTEGER NOT NULL CHECK (enviada IN (0,1)),
    branch            TEXT NOT NULL
  );
INSERT INTO demanda_nova
  SELECT id, projeto, titulo, tipo, descricao,
         CASE fase
           WHEN 'registro' THEN 'entender_e_desenhar'
           WHEN 'aprovacao_demanda' THEN 'gate_demanda'
           WHEN 'planejamento' THEN 'planejar'
           WHEN 'aprovacao_planejamento' THEN 'gate_planejamento'
           WHEN 'execucao' THEN 'em_execucao'
           WHEN 'revisao_demanda' THEN 'revisar_demanda'
           WHEN 'encerramento' THEN 'encerrar_demanda'
           ELSE fase END,
         fase_alterada_em, criada_por_ferramenta, criada_por_sessao, enviada, branch
  FROM demanda ORDER BY rowid;
CREATE TABLE rodada_nova (
    demanda_id TEXT NOT NULL REFERENCES demanda(id),
    rodada_id  INTEGER NOT NULL,
    titulo     TEXT NOT NULL,
    estado     TEXT NOT NULL CHECK (estado IN ('implementar','revisar_rodada','encerrar_rodada','gate_pr','ajustar_resultado','concluida')),
    estado_alterado_em TEXT NOT NULL,
    e2e        INTEGER NOT NULL CHECK (e2e IN (0,1)),
    branch     TEXT NOT NULL,
    PRIMARY KEY (demanda_id, rodada_id)
  );
INSERT INTO rodada_nova
  SELECT r.demanda_id, r.rodada_id, r.titulo,
         CASE r.fase
           WHEN 'desenvolvimento' THEN 'implementar'
           WHEN 'revisao' THEN 'revisar_rodada'
           WHEN 'encerramento' THEN 'encerrar_rodada'
           WHEN 'aprovacao_pull_request' THEN 'gate_pr'
           WHEN 'sessao' THEN 'ajustar_resultado'
           ELSE r.fase END,
         COALESCE(
           (SELECT MAX(t.status_alterado_em) FROM ticket_demanda t WHERE t.demanda_id = r.demanda_id AND t.rodada_id = r.rodada_id),
           (SELECT d.fase_alterada_em FROM demanda d WHERE d.id = r.demanda_id)),
         r.e2e, r.branch
  FROM rodada r ORDER BY r.rowid;
CREATE TABLE ticket_demanda_novo (
    demanda_id         TEXT NOT NULL REFERENCES demanda(id),
    ticket_id          INTEGER NOT NULL,
    etapa              TEXT NOT NULL CHECK (etapa IN ('entender_e_desenhar','planejar','implementar','revisar_rodada','encerrar_rodada','ajustar_resultado','revisar_demanda','encerrar_demanda','resolver_conflito')),
    estado             TEXT NOT NULL CHECK (estado IN ('aberto','em_execucao','concluido','falhou','cancelado')),
    estado_alterado_em TEXT NOT NULL,
    rodada_id          INTEGER,
    titulo             TEXT,
    descricao          TEXT,
    modelo_provedor    TEXT,
    modelo_nome        TEXT,
    effort             TEXT CHECK (effort IS NULL OR effort IN ('off','minimal','low','medium','high','xhigh','max')),
    instrucao          TEXT,
    devolucoes         INTEGER NOT NULL DEFAULT 0 CHECK (devolucoes BETWEEN 0 AND 2),
    motivo_falha       TEXT CHECK (motivo_falha IS NULL OR length(motivo_falha) > 0),
    criado_em          TEXT,
    concluido_em       TEXT,
    retomadas_automaticas INTEGER NOT NULL DEFAULT 0 CHECK (retomadas_automaticas >= 0),
    criado_por_tipo    TEXT NOT NULL DEFAULT 'fabriquinha' CHECK (criado_por_tipo IN ('auditor','agente','fabriquinha','externo')),
    criado_por_trabalho_id TEXT CHECK ((criado_por_tipo = 'agente') = (criado_por_trabalho_id IS NOT NULL)),
    PRIMARY KEY (demanda_id, ticket_id),
    UNIQUE (demanda_id, ticket_id, rodada_id),
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id),
    CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
  );
INSERT INTO ticket_demanda_novo
  SELECT demanda_id, ticket_id,
         CASE etapa WHEN 'demanda' THEN 'entender_e_desenhar' WHEN 'sessao_em_aberto' THEN 'ajustar_resultado' ELSE etapa END,
         CASE status WHEN 'fechado' THEN 'cancelado' ELSE status END,
         status_alterado_em, rodada_id, titulo, descricao, modelo_provedor, modelo_nome, effort, instrucao, devolucoes,
         motivo_falha, criado_em, concluido_em, retomadas_automaticas, criado_por_tipo, criado_por_trabalho_id
  FROM ticket_demanda ORDER BY rowid;
CREATE TABLE configuracao_etapa_projeto_nova (
    projeto         TEXT NOT NULL REFERENCES projeto(nome) ON DELETE CASCADE,
    etapa           TEXT NOT NULL CHECK (etapa IN ('entender_e_desenhar','planejar','implementar','revisar_rodada','encerrar_rodada','ajustar_resultado','revisar_demanda','encerrar_demanda','resolver_conflito')),
    modelo_provedor TEXT CHECK (modelo_provedor IS NULL OR length(modelo_provedor) > 0),
    modelo_nome     TEXT CHECK (modelo_nome IS NULL OR length(modelo_nome) > 0),
    effort          TEXT CHECK (effort IS NULL OR effort IN ('off','minimal','low','medium','high','xhigh','max')),
    PRIMARY KEY (projeto, etapa),
    CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
  );
INSERT INTO configuracao_etapa_projeto_nova
  SELECT projeto,
         CASE etapa WHEN 'demanda' THEN 'entender_e_desenhar' WHEN 'sessao_em_aberto' THEN 'ajustar_resultado' ELSE etapa END,
         modelo_provedor, modelo_nome, effort
  FROM configuracao_etapa_projeto ORDER BY rowid;
CREATE TABLE sequencia_nova (
    nome  TEXT PRIMARY KEY CHECK (nome IN ('demanda','ticket','execucao','decisao','evidencia','proposta')),
    valor INTEGER NOT NULL CHECK (valor >= 0)
  );
INSERT INTO sequencia_nova SELECT CASE nome WHEN 'issue' THEN 'demanda' ELSE nome END, valor FROM sequencia ORDER BY rowid;
DROP TABLE ticket_demanda;
DROP TABLE rodada;
DROP TABLE demanda;
DROP TABLE configuracao_etapa_projeto;
DROP TABLE sequencia;
ALTER TABLE demanda_nova RENAME TO demanda;
ALTER TABLE rodada_nova RENAME TO rodada;
ALTER TABLE ticket_demanda_novo RENAME TO ticket_demanda;
ALTER TABLE configuracao_etapa_projeto_nova RENAME TO configuracao_etapa_projeto;
ALTER TABLE sequencia_nova RENAME TO sequencia;
`;

const TABELAS_DA_CONFIGURACAO_DO_PROJETO = [
  "configuracao_etapa_projeto",
  "comando_preparacao_projeto",
  "fitness_function_projeto",
  "linguagem_projeto",
  "configuracao_e2e",
  "glob_e2e",
];

/**
 * A 39 dá ao projeto os nomes do vocabulário único: `repo` vira `raiz_git` e `sonar_project_key`, `chave_sonarqube`. O
 * `cursor_commit_humano` é estado da varredura de commits humanos: passa para `varredura_base.ultimo_sha` e sai de
 * `projeto`. Projeto que já tem varredura mantém o cursor dela (é o que a varredura usa); o cursor copiado leva `em` na
 * época, para a próxima varredura rodar. Confere que as tabelas da configuração do projeto não mudaram de tamanho, e
 * recusa (desfazendo a transação) se mudaram.
 */
const MIGRACAO_39_PROJETO_UNICO: Migracao = (banco) => {
  const contarLinhas = () =>
    TABELAS_DA_CONFIGURACAO_DO_PROJETO.map(
      (tabela) => (banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get() as { n: number }).n,
    );
  const antes = contarLinhas();
  banco.exec(`
ALTER TABLE projeto RENAME COLUMN repo TO raiz_git;
ALTER TABLE projeto RENAME COLUMN sonar_project_key TO chave_sonarqube;
INSERT INTO varredura_base (projeto, ultimo_sha, em)
  SELECT nome, cursor_commit_humano, '1970-01-01T00:00:00.000Z' FROM projeto WHERE cursor_commit_humano IS NOT NULL ORDER BY rowid
  ON CONFLICT (projeto) DO NOTHING;
ALTER TABLE projeto DROP COLUMN cursor_commit_humano;
`);
  const depois = contarLinhas();
  const mudou = TABELAS_DA_CONFIGURACAO_DO_PROJETO.filter((_, i) => antes[i] !== depois[i]);
  if (mudou.length > 0) {
    throw new ErroDeRegra(
      `a migração 39 mudou o número de linhas de ${mudou.join(", ")}`,
      "restaure o banco do backup e relate o problema",
    );
  }
};

const MOTIVO_ANTERIOR_A_MIGRACAO = "(motivo anterior à migração 40)";

interface TentativaSintetica {
  resultado_tipo: "reprovacao" | "falha_infraestrutura" | "interrompida";
  /** A causa da falha de infraestrutura; em `interrompida`, o tipo do Ator que interrompeu. */
  causa: string;
  motivo?: string;
  instrucao?: string;
}

const interrompidaPelaFabriquinha = (motivo: string): TentativaSintetica => ({
  resultado_tipo: "interrompida",
  causa: "fabriquinha",
  motivo,
});

/**
 * A 40 troca os contadores do ticket por Tentativas: cada ticket ganha as sintéticas (`migrada = 1`) que reproduzem o que
 * as colunas diziam — `devolucoes` de reprovação e `retomadas_automaticas` de falha de infraestrutura, de causa
 * `tempo_limite`, pois a causa de cada uma não foi guardada — e o `motivo_falha` vai para a última delas (ou para uma
 * `interrompida`, se não há nenhuma). O `erro` das execuções ocupa as falhas de infraestrutura na ordem e, passando delas,
 * vira `interrompida`; a instrução de uma reabertura sem devolução vira a Tentativa do Auditor. Depois saem
 * `devolucoes`, `retomadas_automaticas` e `motivo_falha` de `ticket_demanda` e `erro` de `execucao_sessao`.
 */
const MIGRACAO_40_TENTATIVA: Migracao = (banco) => {
  banco.exec(`
CREATE TABLE tentativa (
    demanda_id     TEXT NOT NULL,
    ticket_id      INTEGER NOT NULL,
    numero         INTEGER NOT NULL CHECK (numero > 0),
    processo_id    TEXT CHECK (processo_id IS NULL OR length(processo_id) > 0),
    inicio         TEXT NOT NULL,
    fim            TEXT,
    resultado_tipo TEXT CHECK (resultado_tipo IS NULL OR resultado_tipo IN ('sucesso','reprovacao','falha_infraestrutura','interrompida')),
    causa          TEXT CHECK ((causa IS NOT NULL) = (resultado_tipo IN ('falha_infraestrutura','interrompida'))),
    motivo         TEXT CHECK (motivo IS NULL OR length(motivo) > 0),
    instrucao      TEXT CHECK (instrucao IS NULL OR length(instrucao) > 0),
    migrada        INTEGER NOT NULL DEFAULT 0 CHECK (migrada IN (0,1)),
    PRIMARY KEY (demanda_id, ticket_id, numero),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id)
  );
`);
  const inserir = banco.prepare(
    `INSERT INTO tentativa (demanda_id, ticket_id, numero, inicio, fim, resultado_tipo, causa, motivo, instrucao, migrada)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const errosDasExecucoes = banco.prepare(
    `SELECT e.erro FROM execucao_sessao e JOIN sessao s ON s.id = e.sessao_id
     WHERE s.demanda_id = ? AND s.ticket_id = ? AND e.erro IS NOT NULL ORDER BY e.inicio, e.rowid`,
  );
  const tickets = banco
    .prepare(
      `SELECT demanda_id, ticket_id, estado_alterado_em, instrucao, devolucoes, motivo_falha, retomadas_automaticas
       FROM ticket_demanda ORDER BY rowid`,
    )
    .all();
  for (const t of tickets) {
    const demandaId = String(t.demanda_id);
    const ticketId = Number(t.ticket_id);
    const instante = String(t.estado_alterado_em);
    const devolucoes = Number(t.devolucoes);
    const retomadas = Number(t.retomadas_automaticas);
    const motivoFalha = t.motivo_falha === null ? undefined : String(t.motivo_falha);
    const instrucao = t.instrucao === null ? undefined : String(t.instrucao);
    // O erro era texto livre e pode passar do teto do Markdown; o corte é o de `motivo()`.
    const erros = errosDasExecucoes.all(demandaId, ticketId).map((linha) => String(linha.erro).slice(0, 2000));
    const historico: TentativaSintetica[] = [
      ...erros
        .slice(retomadas)
        .filter((erro) => erro !== motivoFalha)
        .map(interrompidaPelaFabriquinha),
      ...(instrucao !== undefined && devolucoes === 0
        ? [{ resultado_tipo: "interrompida" as const, causa: "auditor", instrucao }]
        : []),
      ...Array.from({ length: devolucoes }, (_, i) => ({
        resultado_tipo: "reprovacao" as const,
        causa: "",
        motivo: i === devolucoes - 1 && instrucao !== undefined ? instrucao : MOTIVO_ANTERIOR_A_MIGRACAO,
      })),
      ...Array.from({ length: retomadas }, (_, i) => ({
        resultado_tipo: "falha_infraestrutura" as const,
        causa: "tempo_limite",
        motivo: erros[i] ?? MOTIVO_ANTERIOR_A_MIGRACAO,
      })),
    ];
    const ultima = historico.at(-1);
    if (motivoFalha !== undefined) {
      if (ultima === undefined || ultima.resultado_tipo === "interrompida") {
        historico.push(interrompidaPelaFabriquinha(motivoFalha));
      } else {
        ultima.motivo = motivoFalha;
      }
    }
    historico.forEach((h, i) => {
      inserir.run(
        demandaId,
        ticketId,
        i + 1,
        instante,
        instante,
        h.resultado_tipo,
        h.resultado_tipo === "reprovacao" ? null : h.causa,
        h.motivo ?? null,
        h.instrucao ?? null,
      );
    });
  }
  banco.exec(`
ALTER TABLE ticket_demanda DROP COLUMN devolucoes;
ALTER TABLE ticket_demanda DROP COLUMN retomadas_automaticas;
ALTER TABLE ticket_demanda DROP COLUMN motivo_falha;
ALTER TABLE execucao_sessao DROP COLUMN erro;
`);
};

const GATE_PELA_ETAPA_ANCORA = `CASE t.etapa
    WHEN 'entender_e_desenhar' THEN 'gate_demanda'
    WHEN 'planejar' THEN 'gate_planejamento'
    WHEN 'encerrar_rodada' THEN 'gate_pr'
    WHEN 'revisar_rodada' THEN 'gate_revisao_rodada'
    WHEN 'revisar_demanda' THEN 'gate_revisao_demanda'
  END`;

/** Os quatro gates que `decisao_ticket_historico` conhecia, nos nomes de hoje (`revisao` era o da rodada). */
const GATE_PELO_HISTORICO = `CASE h.gate
    WHEN 'registro' THEN 'gate_demanda'
    WHEN 'desenho' THEN 'gate_planejamento'
    WHEN 'pr' THEN 'gate_pr'
    WHEN 'revisao' THEN 'gate_revisao_rodada'
  END`;

const DECISOES_COM_ETAPA_ANCORA = `FROM decisao_ticket d
  LEFT JOIN ticket_demanda t ON t.demanda_id = d.demanda_id AND t.ticket_id = d.ticket_id`;

const ENDERECO_DA_DECISAO = `d.demanda_id || '.T' || d.ticket_id || '#' || d.decisao_id`;

/**
 * A 41 dá a cada Decisão o gate de que é, pela etapa do ticket âncora, e troca o valor antigo do resultado por
 * `reprovado`. Havendo linha em `decisao_ticket_historico`, o gate dela precisa bater com o da etapa; essa tabela sai
 * depois da conferência. Etapa que não é de um dos cinco gates, ou histórico divergente, recusa a migração (desfeita
 * pelo `migrar`, com o banco na v40 intacto).
 */
const MIGRACAO_41_GATE_DA_DECISAO: Migracao = (banco) => {
  const enderecosSemGate = banco
    .prepare(
      `SELECT ${ENDERECO_DA_DECISAO} AS endereco ${DECISOES_COM_ETAPA_ANCORA} WHERE ${GATE_PELA_ETAPA_ANCORA} IS NULL`,
    )
    .all()
    .map((linha) => String(linha.endereco));
  if (enderecosSemGate.length > 0) {
    throw new ErroDeRegra(
      `a migração 41 não achou o gate das decisões ${enderecosSemGate.join(", ")}: a etapa do ticket não é de um gate`,
      "restaure o banco do backup e relate o problema",
    );
  }
  const enderecosDivergentes = banco
    .prepare(
      `SELECT ${ENDERECO_DA_DECISAO} AS endereco ${DECISOES_COM_ETAPA_ANCORA}
       JOIN decisao_ticket_historico h
         ON h.demanda_id = d.demanda_id AND h.ticket_id = d.ticket_id AND h.decisao_id = d.decisao_id
       WHERE ${GATE_PELO_HISTORICO} IS NOT ${GATE_PELA_ETAPA_ANCORA}`,
    )
    .all()
    .map((linha) => String(linha.endereco));
  if (enderecosDivergentes.length > 0) {
    throw new ErroDeRegra(
      `a migração 41 achou o gate do histórico diferente do da etapa nas decisões ${enderecosDivergentes.join(", ")}`,
      "restaure o banco do backup e relate o problema",
    );
  }
  banco.exec(`
CREATE TABLE decisao_ticket_nova (
    demanda_id      TEXT NOT NULL,
    ticket_id       INTEGER NOT NULL,
    decisao_id      INTEGER NOT NULL,
    gate            TEXT NOT NULL CHECK (gate IN ('gate_demanda','gate_planejamento','gate_pr','gate_revisao_rodada','gate_revisao_demanda')),
    resultado       TEXT NOT NULL CHECK (resultado IN ('aprovado','reprovado')),
    nota            INTEGER CHECK (nota BETWEEN 1 AND 5),
    motivo          TEXT,
    por_tipo        TEXT NOT NULL CHECK (por_tipo IN ('auditor','agente','fabriquinha')),
    por_trabalho_id TEXT CHECK (por_trabalho_id IS NULL OR por_tipo = 'agente'),
    em              TEXT NOT NULL,
    PRIMARY KEY (demanda_id, ticket_id, decisao_id),
    FOREIGN KEY (demanda_id, ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id)
  );
INSERT INTO decisao_ticket_nova
  SELECT d.demanda_id, d.ticket_id, d.decisao_id, ${GATE_PELA_ETAPA_ANCORA},
         CASE WHEN d.resultado = 'aprovado' THEN 'aprovado' ELSE 'reprovado' END,
         d.nota, d.motivo, d.por_tipo, d.por_trabalho_id, d.em
  ${DECISOES_COM_ETAPA_ANCORA} ORDER BY d.rowid;
DROP TABLE decisao_ticket_historico;
DROP TABLE decisao_ticket;
ALTER TABLE decisao_ticket_nova RENAME TO decisao_ticket;
`);
};

/**
 * A 42 dá os nomes do Trabalho Agêntico às tabelas da sessão: `sessao` vira `trabalho_agentico`, `execucao_sessao`
 * `processo_do_trabalho` (com `sessao_id` virando `trabalho_id`) e `sessao_externa_demanda` `trabalho_nao_gerenciado`.
 * O RENAME mantém as linhas, os ids e os CHECK, e leva junto as FKs de quem as referencia (`processo_do_trabalho`,
 * `uso_modelo_execucao`); só os índices, que carregam o nome antigo, são refeitos. A avaliação ganha `grupo_processo`,
 * que substitui o arquivo `avaliacoes/<id>/pgid`.
 */
const MIGRACAO_42_TRABALHO_AGENTICO = `
ALTER TABLE sessao RENAME TO trabalho_agentico;
ALTER TABLE execucao_sessao RENAME TO processo_do_trabalho;
ALTER TABLE processo_do_trabalho RENAME COLUMN sessao_id TO trabalho_id;
ALTER TABLE sessao_externa_demanda RENAME TO trabalho_nao_gerenciado;
DROP INDEX ix_sessao_ticket;
CREATE INDEX ix_trabalho_agentico_ticket ON trabalho_agentico(demanda_id, ticket_id);
DROP INDEX ix_execucao_sessao_sessao;
CREATE INDEX ix_processo_do_trabalho_trabalho ON processo_do_trabalho(trabalho_id);
ALTER TABLE avaliacao ADD COLUMN grupo_processo INTEGER CHECK (grupo_processo IS NULL OR (typeof(grupo_processo) = 'integer' AND grupo_processo > 0));
`;

/**
 * A 43 cria `pull_request`, o PR de cada Espaço de Trabalho (`rodada_id` nulo é o PR final da demanda), e tira o PR de
 * `encerramento_demanda`. Preenche pela última `pr_aberto` de cada rodada (o `numero` é o `id` dela) e pelo `pr_numero`
 * e `pr_url` do encerramento (o `head` é o `sha_verificado`, ou a branch quando ainda não houve verificação). O estado
 * é `integrado` quando a rodada está concluída ou o encerramento tem `integracao_sha`, senão `aberto`. A garantia
 * "integracao_sha só com PR" deixa de ser CHECK e passa a ser a trigger contra `pull_request`.
 */
const MIGRACAO_43_PULL_REQUEST = `
CREATE TABLE pull_request (
    demanda_id    TEXT NOT NULL REFERENCES demanda(id),
    rodada_id     INTEGER,
    numero        INTEGER NOT NULL CHECK (typeof(numero) = 'integer' AND numero > 0),
    url           TEXT NOT NULL CHECK (length(url) > 0),
    head          TEXT NOT NULL CHECK (length(head) > 0),
    estado        TEXT NOT NULL CHECK (estado IN ('aberto','integrado','fechado')),
    atualizado_em TEXT NOT NULL,
    FOREIGN KEY (demanda_id, rodada_id) REFERENCES rodada(demanda_id, rodada_id)
  );
CREATE UNIQUE INDEX ux_pull_request_rodada ON pull_request(demanda_id, rodada_id) WHERE rodada_id IS NOT NULL;
CREATE UNIQUE INDEX ux_pull_request_demanda ON pull_request(demanda_id) WHERE rodada_id IS NULL;
INSERT INTO pull_request (demanda_id, rodada_id, numero, url, head, estado, atualizado_em)
  SELECT p.demanda_id, p.rodada_id, CAST(json_extract(p.dados, '$.id') AS INTEGER), json_extract(p.dados, '$.url'),
         json_extract(p.dados, '$.head'), CASE WHEN r.estado = 'concluida' THEN 'integrado' ELSE 'aberto' END, p.em
  FROM (
    SELECT e.demanda_id, COALESCE(e.rodada_id, t.rodada_id) AS rodada_id, e.dados, e.em,
           ROW_NUMBER() OVER (PARTITION BY e.demanda_id, COALESCE(e.rodada_id, t.rodada_id) ORDER BY e.em DESC, e.rowid DESC) AS posicao
    FROM evidencia_demanda e LEFT JOIN ticket_demanda t ON t.demanda_id = e.demanda_id AND t.ticket_id = e.ticket_id
    WHERE e.tipo = 'pr_aberto'
  ) p JOIN rodada r ON r.demanda_id = p.demanda_id AND r.rodada_id = p.rodada_id
  WHERE p.posicao = 1;
INSERT INTO pull_request (demanda_id, rodada_id, numero, url, head, estado, atualizado_em)
  SELECT e.demanda_id, NULL, e.pr_numero, e.pr_url, COALESCE(e.sha_verificado, e.branch),
         CASE WHEN e.integracao_sha IS NULL THEN 'aberto' ELSE 'integrado' END, d.estado_alterado_em
  FROM encerramento_demanda e JOIN demanda d ON d.id = e.demanda_id
  WHERE e.pr_numero IS NOT NULL;
CREATE TABLE encerramento_demanda_nova (
    demanda_id        TEXT PRIMARY KEY REFERENCES demanda(id),
    branch            TEXT NOT NULL,
    base              TEXT NOT NULL CHECK (length(base) > 0),
    sha_verificado    TEXT CHECK (sha_verificado IS NULL OR length(sha_verificado) > 0),
    integracao_sha    TEXT CHECK (integracao_sha IS NULL OR length(integracao_sha) > 0),
    conflito_ticket_id INTEGER,
    falha_etapa       TEXT CHECK (falha_etapa IS NULL OR falha_etapa IN ('check_final','integracao','limpeza')),
    falha_motivo      TEXT CHECK (falha_motivo IS NULL OR length(falha_motivo) > 0),
    aguardando_merge_humano INTEGER NOT NULL DEFAULT 0 CHECK (aguardando_merge_humano IN (0, 1)),
    FOREIGN KEY (demanda_id, conflito_ticket_id) REFERENCES ticket_demanda(demanda_id, ticket_id),
    CHECK ((falha_etapa IS NULL) = (falha_motivo IS NULL))
  );
INSERT INTO encerramento_demanda_nova
  SELECT demanda_id, branch, base, sha_verificado, integracao_sha, conflito_ticket_id, falha_etapa, falha_motivo,
         aguardando_merge_humano
  FROM encerramento_demanda ORDER BY rowid;
DROP TABLE encerramento_demanda;
ALTER TABLE encerramento_demanda_nova RENAME TO encerramento_demanda;
CREATE TRIGGER encerramento_demanda_integracao_so_com_pr_na_insercao BEFORE INSERT ON encerramento_demanda
  WHEN NEW.integracao_sha IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pull_request WHERE demanda_id = NEW.demanda_id AND rodada_id IS NULL)
  BEGIN SELECT RAISE(ABORT, 'integracao_sha exige o PR final em pull_request'); END;
CREATE TRIGGER encerramento_demanda_integracao_so_com_pr_na_atualizacao BEFORE UPDATE ON encerramento_demanda
  WHEN NEW.integracao_sha IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pull_request WHERE demanda_id = NEW.demanda_id AND rodada_id IS NULL)
  BEGIN SELECT RAISE(ABORT, 'integracao_sha exige o PR final em pull_request'); END;
`;

const MOTIVO_DA_EVIDENCIA_RECUSADA = "(evidência recusada antes da migração 44)";

/**
 * A 44 acaba com `aprovada` nos `dados` da evidência: só a submissão aceita vira Evidência. Cada evidência com
 * `aprovada = false` sai de `evidencia_demanda` (com os anexos e o histórico) e vira uma Tentativa sintética de
 * reprovação do ticket dono — a da rodada ou da demanda, que não têm ticket, vai para o último ticket delas — com o
 * `motivo` e a submissão em JSON (`tipo`, `dono`, `produtor`, `dados`, `anexos`). Com `aprovada = true` só a chave sai.
 * Os pareceres (`comprovacao_criterios`, `testes_estresse` e `analise_seguranca`) nunca gravaram `aprovada`: o
 * `veredito` deles é derivado, então nada é convertido.
 */
const MIGRACAO_44_EVIDENCIA_ACEITA: Migracao = (banco) => {
  banco.exec("ALTER TABLE tentativa ADD COLUMN submissao TEXT CHECK (submissao IS NULL OR json_valid(submissao))");
  const recusadas = banco
    .prepare(
      `SELECT e.id, e.demanda_id, e.rodada_id, e.ticket_id, e.tipo, e.dados, e.em,
              COALESCE(e.ticket_id, (SELECT max(t.ticket_id) FROM ticket_demanda t
                 WHERE t.demanda_id = e.demanda_id AND (e.rodada_id IS NULL OR t.rodada_id = e.rodada_id))) AS dono_ticket
       FROM evidencia_demanda e WHERE json_extract(e.dados, '$.aprovada') = 0 ORDER BY e.rowid`,
    )
    .all();
  const anexosDe = banco.prepare("SELECT caminho FROM arquivo_evidencia WHERE evidencia_id = ? ORDER BY ordem");
  const proximoNumero = banco.prepare(
    "SELECT COALESCE(max(numero), 0) + 1 AS numero FROM tentativa WHERE demanda_id = ? AND ticket_id = ?",
  );
  const inserirTentativa = banco.prepare(
    `INSERT INTO tentativa (demanda_id, ticket_id, numero, inicio, fim, resultado_tipo, motivo, migrada, submissao)
     VALUES (?, ?, ?, ?, ?, 'reprovacao', ?, 1, ?)`,
  );
  for (const e of recusadas) {
    const demandaId = String(e.demanda_id);
    if (e.dono_ticket === null) {
      throw new ErroDeRegra(
        `a migração 44 não achou ticket para a evidência recusada ${String(e.id)} de ${demandaId}`,
        "restaure o banco do backup e relate o problema",
      );
    }
    const dados = JSON.parse(String(e.dados)) as Record<string, unknown>;
    delete dados.aprovada;
    const dono = {
      demanda_id: demandaId,
      ...(e.rodada_id === null ? {} : { rodada_id: e.rodada_id }),
      ...(e.ticket_id === null ? {} : { ticket_id: e.ticket_id }),
    };
    const submissao = {
      tipo: e.tipo,
      dono,
      produtor: { tipo: "fabriquinha" },
      dados,
      anexos: anexosDe.all(String(e.id)).map((anexo) => anexo.caminho),
    };
    const ticketId = Number(e.dono_ticket);
    const { numero } = proximoNumero.get(demandaId, ticketId) as { numero: number };
    inserirTentativa.run(
      demandaId,
      ticketId,
      numero,
      String(e.em),
      String(e.em),
      MOTIVO_DA_EVIDENCIA_RECUSADA,
      JSON.stringify(submissao),
    );
    banco.prepare("DELETE FROM arquivo_evidencia WHERE evidencia_id = ?").run(String(e.id));
    banco.prepare("DELETE FROM evidencia_historico WHERE evidencia_id = ?").run(String(e.id));
    banco.prepare("DELETE FROM evidencia_demanda WHERE id = ?").run(String(e.id));
  }
  banco.exec(
    "UPDATE evidencia_demanda SET dados = json_remove(dados, '$.aprovada') WHERE json_extract(dados, '$.aprovada') IS NOT NULL",
  );
};

/** As migrações depois da linha de base: a primeira é a 37. */
export const MIGRACOES: readonly Migracao[] = [
  MIGRACAO_37_AUTORIA,
  MIGRACAO_38_ESTADO,
  MIGRACAO_39_PROJETO_UNICO,
  MIGRACAO_40_TENTATIVA,
  MIGRACAO_41_GATE_DA_DECISAO,
  MIGRACAO_42_TRABALHO_AGENTICO,
  MIGRACAO_43_PULL_REQUEST,
  MIGRACAO_44_EVIDENCIA_ACEITA,
];

# F2 — Persistência

Sistema: Fabriquinha.
Depende de: F1 (entidades, comandos e enums).
Usado por: F3 a F7.

## 1. Responsabilidade

- Guardar as entidades do F1 num banco SQLite e aplicar cada comando do domínio numa transação.
- Reforçar no banco as invariantes do F1 que cabem em constraint, para que nem um bug nem um acesso direto as quebre.
- Guardar os arquivos das evidências (vídeos, imagens, relatórios) de forma imutável e verificável.

Não decide regra de negócio: só carrega, grava e protege.

## 2. Raiz e layout em disco

A raiz é `$FABRIQUINHA_ROOT` ou, sem a variável, `~/fabriquinha`.

```
~/fabriquinha/
├── fabriquinha.db          # banco (F2)
├── fabriquinha.db-wal      # journal do modo WAL (F2)
├── arquivos/ab/abcdef….    # arquivos de evidência, endereçados por SHA-256 (F2)
├── sessoes/                # sessões do pi, passadas por --session-dir (F4)
├── execucoes/E-7/         # log da execução e saida/ para vídeos e prints do agente (F4)
├── simulacoes/12/          # uma execução simulada: anexos, sessao/, log e saida/relatorio.json (F8)
└── worktrees/<projeto>/I-12/   # uma worktree por issue (F5)
```

Diretórios são criados com permissão `0700` e arquivos com `0600`: evidências podem conter telas e dados sensíveis.
Só `fabriquinha.db` e `arquivos/` são deste módulo; os demais aparecem aqui para dar a visão do todo.

## 3. Banco

### 3.1 Motor e conexão

- `DatabaseSync` de `node:sqlite`, embutido no Node ≥ 22.13 (D1).
  O módulo ainda emite `ExperimentalWarning`; o `bin/fabriquinha` roda o Node com `--disable-warning=ExperimentalWarning`.
- Toda conexão aplica, nesta ordem:

| PRAGMA | Valor | Motivo |
|---|---|---|
| `journal_mode` | `WAL` | O web lê enquanto o agendador e os agentes escrevem. |
| `foreign_keys` | `ON` | Vale por conexão; sem ele as FKs não são checadas. |
| `busy_timeout` | `5000` | Espera o lock em vez de falhar na hora com `SQLITE_BUSY`. |
| `synchronous` | `NORMAL` | Seguro em WAL e evita fsync a cada commit. |

### 3.2 Transações

- Toda escrita roda em `BEGIN IMMEDIATE`: o lock de escrita é pego no início, e duas escritas nunca entram em deadlock ao promover o lock.
- **Nenhuma transação espera I/O externo.**
  Rodar o pi, os testes, o SonarQube ou o git acontece fora da transação.
  O padrão é o mesmo do `closeIssue` atual: ler, fazer o trabalho externo, depois abrir a transação, reconferir o estado e gravar.
- Erro dentro da transação faz `ROLLBACK` e propaga o erro original.

### 3.3 Aplicação de um comando do domínio

```ts
function comIssue(banco: Banco, issue: number, nome: NomeComando, ator: Ator, comando: (agregado: Agregado, ctx: Contexto) => Agregado): Agregado;
```

1. `BEGIN IMMEDIATE`.
2. Carrega o agregado: a issue, os seus tickets, execuções, decisões e metadados de evidência.
3. Monta o contexto: `agora`, `novoId(tipo)` e os fatos externos de que o comando precisa (3.5).
4. Executa o comando do F1.
5. Compara o agregado carregado com o devolvido e grava só a diferença: insere o que é novo, atualiza o que mudou e apaga o que sumiu.
6. Grava uma linha em `comando` com o nome, o ator e a fase da issue antes do comando (tabela do F6, seção 7).
   É o que permite medir ajustes do Auditor que o estado final apaga (F6, 5.1).
7. `COMMIT`.

`registrarIssue` (C1) e `arquivarConcluidas` (C18) não partem de um agregado existente; têm funções próprias com as mesmas garantias.

ponytail: a comparação é linha a linha, por igualdade de JSON.
O agregado de uma issue tem dezenas de linhas; se um dia passar de milhares, trocar por gravação dirigida por eventos do domínio.

### 3.4 IDs

- O contexto entrega `novoId(tipo)`, que incrementa a tabela `sequencia` dentro da transação.
  Como as escritas são serializadas por `BEGIN IMMEDIATE`, não há corrida.
- Cada tipo tem a sua sequência: `I-1` e `T-1` convivem, e o prefixo desfaz a ambiguidade.
  Os tipos são `issue`, `ticket`, `execucao`, `decisao`, `evidencia` e `entrega` (`N-n`); `proposta` (`P-n`) existiu até a migração da remoção do registro e do desenho.

### 3.5 Fatos externos fornecidos ao domínio

Consultados dentro da mesma transação, então são consistentes com o que vai ser gravado.

| Fato | Usado por | Consulta |
|---|---|---|
| `depsConcluidas(issue)` | C5 | todas as linhas de `issue_dep` da issue apontam para issue `concluida` |
| `alcancaveis(dep)` | C1, C3 (ciclo) | CTE recursiva sobre `issue_dep` a partir de `dep` |
| `issueExiste(id)` | C1, C3 | busca por chave |
| `projeto(nome)` | C1, C19 | busca por chave |

### 3.6 Datas, booleanos e JSON

- Instantes: `TEXT` em ISO 8601 UTC (`toISOString()`), que ordena corretamente como texto.
- Booleanos: `INTEGER` 0 ou 1, com `CHECK`.
- Listas e objetos de configuração: `TEXT` com `CHECK (json_valid(...))`.
  O que as métricas consultam vira coluna ou tabela própria, não JSON.

### 3.7 Schema e migrações

- A versão fica em `PRAGMA user_version`.
- As migrações são uma lista ordenada de scripts SQL, aplicada na abertura do banco, cada uma na sua transação.
- As listas dos `CHECK ... IN (...)` são geradas a partir dos enums `zod` do F1 (`Fase.options`, `Etapa.options` etc.).
  Assim o banco e o domínio não divergem.
- `migrar` desliga `foreign_keys` antes do laço (o PRAGMA não vale dentro de transação) e liga de novo num `finally`, porque recriar uma tabela com DROP/RENAME falha com FK ligada (`defer_foreign_keys` e `legacy_alter_table` não resolvem).
  Em troca, cada migração roda `PRAGMA foreign_key_check` antes do COMMIT e é desfeita com `ErroDeRegra` se sobrar linha órfã.
- A migração do C22 (F1) acrescenta `issue.cancelada_em`, recria `ticket` com `fechado` e `cancelado` no CHECK de `status` (tabela nova, cópia, DROP, RENAME e os dois índices únicos) e cria `ix_issue_dep_dep` em `issue_dep(dep)`, para a busca das dependentes.
- As migrações 12 a 15 são da Simulação (F8, I-10): `projeto.link_produto` (12), `usuario_simulado` e `usuario_simulado_anexo` (13), `tarefa` e `tarefa_usuario` (14) e `execucao_simulada` (15).
- A migração 16 (proposta de issue, C23 e C24 do F1) cria `proposta_issue` e `ix_proposta_issue_ticket` e recria `sequencia` com o tipo `proposta` no CHECK (tabela nova, `INSERT … SELECT`, DROP, RENAME), preservando os valores.
  A migração 1 guarda a lista de tipos original, para a lista nova só valer a partir da 16.
- Uma migração que muda o significado de dados existentes é marcada `precisaAprovacao` e traz uma função de prévia que lê o banco sem alterá-lo.
  Na abertura, as migrações sem a marca rodam como hoje; a primeira com a marca para a lista, e o F4 sobe só o web com a página de migração (F7).
  Aprovada, a F2 copia o arquivo do banco para `<raiz>/backup/fabriquinha-<instante>.db` e roda as pendentes, cada uma na sua transação.
- A migração da Entrega cria `entrega`, `entrega_dep`, `ticket_dep`, `ticket.entrega` e `issue.sessao_externa_ferramenta`/`issue.sessao_externa`, acrescenta o tipo `entrega` à `sequencia`, e converte cada issue em `desenvolvimento` ou adiante numa entrega única que herda a branch, o PR, os tickets e o histórico (precisa de aprovação).
- A migração da remoção do registro e do desenho cancela as issues em `registro`, `desenho` e `aprovacao_desenho` com o motivo da troca de fluxo e remove `proposta_issue` (precisa de aprovação).
- A migração dos custos realizados cria `uso_externo` (F6, 7).
- As tabelas de outros módulos (`configuracao` no F4; `commit_ticket` e `arquivo_commit` no F5; `uso`, `retrabalho`, `comando` e `varredura_base` no F6) são definidas nas specs desses módulos e entram no mesmo arquivo de schema.

## 4. DDL (versão 1)

`<…>` marca as listas geradas a partir dos enums do F1.

```sql
CREATE TABLE sequencia (
  nome  TEXT PRIMARY KEY CHECK (nome IN ('issue','ticket','execucao','decisao','evidencia')),
  valor INTEGER NOT NULL CHECK (valor >= 0)
);

CREATE TABLE projeto (
  nome              TEXT PRIMARY KEY CHECK (length(nome) BETWEEN 1 AND 64),
  repo              TEXT NOT NULL UNIQUE,
  branch_base       TEXT NOT NULL,
  hospedagem        TEXT NOT NULL CHECK (hospedagem IN ('github','azure-devops')),
  preparacao        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(preparacao)),
  testes            TEXT NOT NULL CHECK (json_valid(testes) AND json_array_length(testes) >= 1),
  sonar_project_key TEXT NOT NULL,
  fitness           TEXT NOT NULL CHECK (json_valid(fitness) AND json_array_length(fitness) >= 1),
  modelos           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(modelos)),
  efforts           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(efforts)), -- migração 19
  link_produto      TEXT -- opcional: endereço http(s) do produto no ar, para a Simulação (I-10); NULL = sem link
);

CREATE TABLE issue (
  id           INTEGER PRIMARY KEY,
  projeto      TEXT NOT NULL REFERENCES projeto(nome),
  titulo       TEXT CHECK (length(titulo) BETWEEN 1 AND 120),
  tipo         TEXT CHECK (tipo IN ('funcionalidade','problema')),
  descricao    TEXT NOT NULL DEFAULT '',
  fase         TEXT NOT NULL CHECK (fase IN (<Fase>)),
  criada_em    TEXT NOT NULL,
  concluida_em TEXT,
  arquivada_em TEXT,
  cancelada_em TEXT,                                                    -- migração do C22
  CHECK ((fase = 'concluida') = (concluida_em IS NOT NULL)),
  CHECK (arquivada_em IS NULL OR fase = 'concluida'),
  CHECK (cancelada_em IS NULL OR fase <> 'concluida'),
  CHECK (fase = 'registro' OR (titulo IS NOT NULL AND tipo IS NOT NULL))  -- a migração da Entrega troca 'registro' por 'demanda'
);

CREATE TABLE issue_dep (
  issue INTEGER NOT NULL REFERENCES issue(id),
  dep   INTEGER NOT NULL REFERENCES issue(id),
  PRIMARY KEY (issue, dep),
  CHECK (issue <> dep)
);
CREATE INDEX ix_issue_dep_dep ON issue_dep(dep);   -- migração do C22

CREATE TABLE ticket (
  id              INTEGER PRIMARY KEY,
  issue           INTEGER NOT NULL REFERENCES issue(id),
  etapa           TEXT NOT NULL CHECK (etapa IN (<Etapa>)),
  titulo          TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
  descricao       TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL CHECK (status IN ('aberto','em_execucao','concluido','falhou','fechado','cancelado')),   -- fechado e cancelado: migração do C22
  origem          TEXT NOT NULL CHECK (origem IN ('fabriquinha','agente','auditor')),
  origem_ticket   INTEGER REFERENCES ticket(id),
  modelo_provedor TEXT,
  modelo_nome     TEXT,
  instrucao       TEXT,               -- F4, seção 6.4
  erro            TEXT,
  criado_em       TEXT NOT NULL,
  concluido_em    TEXT,
  CHECK ((status = 'falhou') = (erro IS NOT NULL)),
  CHECK ((status = 'concluido') = (concluido_em IS NOT NULL)),
  CHECK (origem <> 'agente' OR origem_ticket IS NOT NULL),
  CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
);
-- Invariante 1: no máximo um ticket em execução por issue.
CREATE UNIQUE INDEX ux_ticket_em_execucao ON ticket(issue) WHERE status = 'em_execucao';
-- Invariante 2: etapas diferentes de desenvolvimento têm no máximo um ticket não concluído por issue.
CREATE UNIQUE INDEX ux_ticket_etapa_unica ON ticket(issue, etapa) WHERE etapa <> 'desenvolvimento' AND status <> 'concluido';

CREATE TABLE execucao (
  id              INTEGER PRIMARY KEY,
  ticket          INTEGER NOT NULL REFERENCES ticket(id),
  modo            TEXT NOT NULL CHECK (modo IN ('autonomo','interativo','consulta')),
  sessao_pi       TEXT NOT NULL,
  modelo_provedor TEXT,
  modelo_nome     TEXT,
  pgid_pi         INTEGER,            -- F4, seção 7: grupo de processos do pi, para encerrar sobras após reinício
  resultado       TEXT NOT NULL CHECK (resultado IN ('em_andamento','sucesso','falha')),
  erro            TEXT,
  iniciada_em     TEXT NOT NULL,
  terminada_em    TEXT,
  CHECK ((resultado = 'em_andamento') = (terminada_em IS NULL)),
  CHECK ((resultado = 'falha') = (erro IS NOT NULL)),
  CHECK ((modelo_provedor IS NULL) = (modelo_nome IS NULL))
);
-- Uma execução em andamento por ticket.
CREATE UNIQUE INDEX ux_execucao_por_ticket ON execucao(ticket) WHERE resultado = 'em_andamento';
-- Invariante 3 (uma execução em andamento por issue) fica na C5, dentro da transação de escrita. O D8 saiu: o índice
-- é comum e só mantém a consulta das autônomas em andamento como SEARCH.
CREATE INDEX ix_execucao_autonoma ON execucao(modo) WHERE modo = 'autonomo' AND resultado = 'em_andamento';

CREATE TABLE decisao (
  id       INTEGER PRIMARY KEY,
  issue    INTEGER NOT NULL REFERENCES issue(id),
  ticket   INTEGER NOT NULL REFERENCES ticket(id),
  gate     TEXT NOT NULL CHECK (gate IN ('registro','desenho','revisao','pr')),  -- gerado de Decisao.gate: hoje demanda, planejamento, revisao, pr, revisao_demanda e final
  aprovado INTEGER NOT NULL CHECK (aprovado IN (0,1)),
  motivo   TEXT CHECK (length(motivo) BETWEEN 1 AND 2000),
  nota     INTEGER CHECK (nota BETWEEN 1 AND 5),
  por      TEXT NOT NULL CHECK (por IN ('auditor','agente')),
  em       TEXT NOT NULL,
  -- Invariante 7.
  CHECK ((por = 'agente') = (gate = 'revisao')),
  CHECK (aprovado = 1 OR motivo IS NOT NULL),
  CHECK ((gate = 'pr') = (nota IS NOT NULL))
);
CREATE UNIQUE INDEX ux_decisao_revisao ON decisao(ticket) WHERE gate = 'revisao';

CREATE TABLE evidencia (
  id       INTEGER PRIMARY KEY,
  ticket   INTEGER NOT NULL REFERENCES ticket(id),
  tipo     TEXT NOT NULL CHECK (tipo IN (<TipoEvidencia>)),
  produtor TEXT NOT NULL CHECK (produtor IN ('agente','fabriquinha')),
  aprovada INTEGER CHECK (aprovada IN (0,1)),
  dados    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dados)),  -- conteúdo estruturado, schema por tipo no F3
  em       TEXT NOT NULL,
  UNIQUE (ticket, tipo)
);

CREATE TABLE evidencia_arquivo (
  evidencia INTEGER NOT NULL REFERENCES evidencia(id) ON DELETE CASCADE,
  nome      TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),   -- nome original, para exibição e download
  sha256    TEXT NOT NULL CHECK (length(sha256) = 64),
  mime      TEXT NOT NULL,
  bytes     INTEGER NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY (evidencia, nome)
);

CREATE TABLE usuario_simulado (                                   -- F8: pessoa fictícia do projeto
  id        INTEGER PRIMARY KEY,
  projeto   TEXT NOT NULL REFERENCES projeto(nome),
  nome      TEXT NOT NULL,
  descricao TEXT NOT NULL,
  UNIQUE (projeto, nome)
);

CREATE TABLE usuario_simulado_anexo (                             -- F8: manuais e outros arquivos que vão para a IA
  usuario INTEGER NOT NULL REFERENCES usuario_simulado(id),
  nome    TEXT NOT NULL,                                          -- nome original; o conteúdo está em arquivos/<sha256> (5.1)
  sha256  TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes   INTEGER NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY (usuario, nome)
);

CREATE TABLE tarefa (                                             -- F8: o que o usuário simulado deve tentar fazer
  id        INTEGER PRIMARY KEY,
  projeto   TEXT NOT NULL REFERENCES projeto(nome),
  texto     TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 2000),
  n         INTEGER NOT NULL CHECK (n BETWEEN 1 AND 20),            -- execuções por usuário alocado
  criada_em TEXT NOT NULL
);
CREATE INDEX ix_tarefa_projeto ON tarefa(projeto);

CREATE TABLE tarefa_usuario (                                     -- F8: os Usuários Simulados alocados à Tarefa
  tarefa  INTEGER NOT NULL REFERENCES tarefa(id),
  usuario INTEGER NOT NULL REFERENCES usuario_simulado(id),
  PRIMARY KEY (tarefa, usuario)
);

CREATE TABLE execucao_simulada (                                  -- F8: uma vez que um Usuário Simulado fez a Tarefa
  id           INTEGER PRIMARY KEY,
  tarefa       INTEGER NOT NULL REFERENCES tarefa(id),
  usuario      INTEGER NOT NULL REFERENCES usuario_simulado(id),
  status       TEXT NOT NULL CHECK (status IN ('na_fila','em_andamento','concluida','falhou')),
  relatorio    TEXT CHECK (relatorio IS NULL OR json_valid(relatorio)),  -- RelatorioSimulacao (F8 5)
  erro         TEXT,
  pgid         INTEGER,                                           -- grupo do pi em andamento, para o reinício matá-lo
  iniciada_em  TEXT,
  terminada_em TEXT,
  CHECK ((status = 'falhou') = (erro IS NOT NULL)),
  CHECK ((status = 'concluida') = (relatorio IS NOT NULL))
);
CREATE INDEX ix_execucao_simulada_tarefa ON execucao_simulada(tarefa);
CREATE INDEX ix_execucao_simulada_pendente ON execucao_simulada(tarefa) WHERE status IN ('na_fila', 'em_andamento');
```

A proposta de issue (migração 16) ficava fora do agregado, presa ao ticket que a fez; a migração da remoção do registro e do desenho apaga a tabela:

```sql
CREATE TABLE proposta_issue (
  id           INTEGER PRIMARY KEY,
  ticket       INTEGER NOT NULL REFERENCES ticket(id),
  titulo       TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
  mensagem     TEXT NOT NULL CHECK (length(trim(mensagem)) >= 1),
  arquivos     INTEGER NOT NULL CHECK (arquivos >= 0),
  status       TEXT NOT NULL CHECK (status IN ('pendente','aceita','recusada')),
  issue_criada INTEGER REFERENCES issue(id),
  em           TEXT NOT NULL,
  decidida_em  TEXT,
  CHECK ((status = 'aceita') = (issue_criada IS NOT NULL)),
  CHECK ((status = 'pendente') = (decidida_em IS NULL))
);
CREATE INDEX ix_proposta_issue_ticket ON proposta_issue(ticket);
```

A Entrega, as dependências entre entregas e entre tickets e a sessão externa da issue (migração da Entrega):

```sql
CREATE TABLE entrega (
  id           INTEGER PRIMARY KEY,
  issue        INTEGER NOT NULL REFERENCES issue(id),
  titulo       TEXT    NOT NULL,
  criterios    TEXT    NOT NULL,                       -- JSON: ids CA-n
  arquivos_previstos TEXT NOT NULL DEFAULT '[]',       -- JSON: padrões de desenho_solucao.arquivosPrevistos
  fase         TEXT    NOT NULL CHECK (fase IN ('desenvolvimento','revisao','encerramento','aprovacao_pr','ajuste_pr','concluida')),
  correcao     INTEGER NOT NULL DEFAULT 0 CHECK (correcao IN (0,1)),
  criada_em    TEXT    NOT NULL,
  iniciada_em  TEXT,
  concluida_em TEXT,
  CHECK ((fase = 'concluida') = (concluida_em IS NOT NULL))
);
CREATE TABLE entrega_dep (entrega INTEGER NOT NULL REFERENCES entrega(id), dep INTEGER NOT NULL REFERENCES entrega(id), PRIMARY KEY (entrega, dep), CHECK (entrega <> dep));
CREATE TABLE ticket_dep  (ticket  INTEGER NOT NULL REFERENCES ticket(id),  dep INTEGER NOT NULL REFERENCES ticket(id),  PRIMARY KEY (ticket, dep),  CHECK (ticket <> dep));
-- issue.sessao_externa_ferramenta TEXT CHECK (… IN ('pi','claude-code','codex')) e issue.sessao_externa TEXT, presentes juntas ou ausentes juntas (F1, 3.4).
-- ticket.entrega INTEGER REFERENCES entrega(id); o índice único de "um ticket em execução" passa a ser por (issue, entrega).
```

As FKs ficam sem `ON DELETE` (comportamento `RESTRICT`), exceto `evidencia_arquivo`.
Remover o projeto apaga `execucao_simulada`, `tarefa_usuario`, `tarefa`, `usuario_simulado_anexo` e `usuario_simulado` antes de `projeto` (`apagarLinhas`), recusa se há execução simulada pendente e apaga as pastas `<raiz>/simulacoes/<id>` (F8 5).
Assim, apagar um ticket que já tem execução, decisão ou evidência falha no banco, e o histórico nunca some por engano.
Os únicos tickets apagados pelo domínio (C8, C13, C28) são de desenvolvimento ainda `aberto`, sem histórico; as únicas entregas apagadas (C8, C28) ainda não começaram.

O que fica só no F1, por não caber em constraint:

- ausência de ciclo nas dependências;
- casamento entre etapa e fase (4.3 do F1);
- evidências obrigatórias por etapa e as regras do C7.

## 5. Arquivos de evidência

### 5.1 Armazenamento por conteúdo

- Cada arquivo é guardado em `arquivos/<2 primeiros hex>/<sha256>`, sem extensão.
  O nome original e o MIME ficam em `evidencia_arquivo`.
- Gravação: copia para um temporário no mesmo diretório calculando o SHA-256 no caminho, faz `fsync` e `rename`.
  O `rename` é atômico, então um arquivo existe inteiro ou não existe.
- Se o hash já existe, nada é copiado: o mesmo print anexado duas vezes ocupa espaço uma vez.
- Os anexos dos Usuários Simulados (F8) usam o mesmo armazenamento, por `guardarBytes`, que recebe o conteúdo já em memória.
  Um arquivo só é apagado do disco (remoção do projeto) se nenhuma evidência nem anexo restante o usa.
- Arquivos nunca são alterados nem apagados.
  Substituir uma evidência troca as linhas do banco; o arquivo antigo continua no disco.

### 5.2 Ordem entre arquivo e banco

1. Gravar os arquivos (5.1) fora da transação.
2. Abrir a transação e gravar `evidencia` e `evidencia_arquivo`.

Se a transação falhar, sobra um arquivo sem referência, que é inofensivo.
ponytail: não há coleta de lixo; os órfãos só nascem de transação que falhou.
Se o disco virar problema, uma varredura que apague hashes sem referência resolve.

### 5.3 Leitura

`caminhoArquivo(sha256)` devolve o caminho no disco.
Antes de servir, o F7 confere que o hash pertence a uma evidência; nunca serve caminho vindo do cliente.

## 6. Interface do módulo

| Função | O que faz |
|---|---|
| `abrir(raiz?)` | Cria a raiz, abre o banco, aplica os PRAGMAs e as migrações pendentes. |
| `comIssue(banco, issue, nome, ator, comando)` | Aplica um comando do F1 sobre o agregado da issue e registra o comando (3.3). |
| `registrarIssue(banco, entrada, ator)` | C1: cria a issue e o ticket de demanda, com a `sessaoExterna`. |
| `arquivarConcluidas(banco, projeto)` | C18: uma transação só; devolve quantas issues do projeto foram arquivadas. |
| `cancelarIssues(banco, issue, ator)` | C22: uma transação só, na issue e nas dependentes diretas e indiretas (`dependentes`); um `cancelarIssue` em `comando` por issue; devolve as issues canceladas e as execuções que terminaram. `comIssue` recusa comando sobre issue cancelada. |
| `salvarProjeto(banco, projeto)` / `projeto(banco, nome)` / `projetos(banco)` | C19 e leituras. |
| `agregado(banco, issue)` | Leitura do agregado, sem transação de escrita. |
| `guardarArquivo(origem) → { sha256, bytes }` | Grava um arquivo no armazenamento por conteúdo (5.1). |
| `guardarBytes(conteudo) → { sha256, bytes }` | Grava um `Buffer` do mesmo jeito (anexo de Usuário Simulado, F8). |
| `caminhoArquivo(sha256)` | Caminho do arquivo no disco. |

As consultas de leitura de cada tela, do agendador e das métricas ficam nas specs do F4, F6 e F7, que são donos delas.

## 7. Verificação

- Testes contra SQLite real numa raiz temporária, sem mock de banco.
- Um teste por constraint: insere direto em SQL uma linha que viola a invariante e espera o erro do SQLite.
  Isso prova que a proteção existe no banco, não só no domínio.
- Um teste de concorrência: dois processos tentam iniciar execução autônoma ao mesmo tempo; um consegue e o outro recebe erro de regra.
- Um teste de arquivo: gravar o mesmo conteúdo duas vezes gera um arquivo só, e o hash confere.

## 8. Fora de escopo

- Backup: copiar `fabriquinha.db` com o banco parado, ou `sqlite3 fabriquinha.db ".backup destino.db"` com ele rodando, junto com `arquivos/`.
  Não há comando próprio.

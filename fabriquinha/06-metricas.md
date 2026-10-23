# F6 — Métricas

Sistema: Fabriquinha.
Depende de: F1 (entidades e comandos), F2 (transações e registro de comandos), F4 (fim da execução), F5 (commits e arquivos por commit).
Usado por: F3 (relatório de produtividade e seção 10 do PR) e F7 (métricas no web).

## 1. Responsabilidade

- Coletar o uso de tokens e o custo de cada execução a partir da sessão do pi.
- Medir o retrabalho: que linhas escritas por um ticket de desenvolvimento foram reescritas depois.
- Definir cada métrica do diagrama como uma leitura sobre fatos já gravados.
- Gerar o relatório de produtividade do SDLC de uma issue, em JSON e HTML.
- Somar consumo e volume de trabalho por mês, por projeto ou no total (5.7).
- Somar aos custos da Fabriquinha os custos realizados fora dela, na demanda, por ferramenta e modelo, sem contar a mesma sessão de ferramenta duas vezes.

O F6 só lê e deriva.
Não muda estado do processo e não barra ticket: métrica nunca é gate.

## 2. Catálogo de métricas

| # | Etapa | Métrica do diagrama | Definição | Fonte |
|---|---|---|---|---|
| M1 | todas | Tokens por modelo e custo | Soma de input, output, cacheRead, cacheWrite e custo das chamadas de LLM, por execução × provedor/modelo (3), mais os custos realizados da demanda, por sessão de ferramenta × provedor/modelo (3.4). | `uso`, `uso_externo` |
| M2 | demanda | Demandas recusadas | Decisões `demanda` recusadas e o custo realizado dessas demandas (5.1). | `decisao`, `uso_externo` |
| M3 | planejamento | Correções no planejamento | Reprovações no gate de planejamento + ajustes que o próprio Auditor fez em entregas, tickets, critérios e dependências (5.1). | `decisao`, `comando` |
| M4 | desenvolvimento | Alterações posteriores no código | Linhas escritas pelo ticket e depois removidas ou reescritas por commit de outro ticket, de qualquer issue do projeto, ou por commit humano na branch base (4). | `retrabalho` |
| M5 | revisao | Exigências de alteração | Tickets de desenvolvimento criados pela revisão (5.2). | `ticket` |
| M6 | revisao | Bugs em arquivos revisados | Issues `problema` registradas depois do merge que alteraram arquivo alterado pela issue revisada (5.3). | `issue`, commits do F5 |
| M7 | encerramento, encerramento_demanda | Feedback humano da qualidade | Nota de cada decisão do gate de PR de cada entrega e do gate final da demanda (5.4). | `decisao` |
| M8 | revisao_demanda | Entregas de correção | Entregas com `correcao = true`, separadas por origem: revisão da demanda ou gate final (5.2). | `entrega` |
| — | todas | Apoio: execuções, falhas, duração e reprovações | Contagens e somas por etapa, pedidas pela seção 10 do PR (F3, 4.6). | `execucao`, `decisao` |

"Correção" é uma devolução no gate ou uma mudança que o Auditor fez com as próprias mãos no trabalho do agente.
A conversa na sessão interativa não conta: não há como separar a explicação inicial da correção.

M1 a M3, M5 e M7 ficam disponíveis assim que o fato acontece.
M4 e M6 crescem com o tempo, porque dependem de commits e issues posteriores.

## 3. Uso de tokens e custo

### 3.1 Fonte

O pi grava a sessão em `<session-dir>/<timestamp>_<id>.jsonl`.
O F6 abre `<raiz>/sessoes/*_<execucao.sessaoPi>.jsonl`; mais de um arquivo para o mesmo ID é erro.

As entradas lidas são as mesmas que o pi soma no `/session` (`getSessionStats`):

| Entrada | Campo | Modelo atribuído |
|---|---|---|
| `message` com `role = assistant` | `message.usage` | `message.provider` / `message.model` |
| `message` com `role = toolResult` e `usage` | `message.usage` (trabalho de LLM feito pela ferramenta) | o da última mensagem do assistente antes dela |
| `compaction` com `usage` | `usage` | idem |
| `branch_summary` com `usage` | `usage` | idem |
| `usage` (ex.: `kind = cache_warm`) | `usage` | `provider` / `model` da entrada, ou o da última mensagem do assistente antes dela |

ponytail: o `usage` aninhado de ferramenta não traz o modelo, então um subagente com outro modelo é contado no modelo de quem o chamou.
Se isso distorcer a comparação entre modelos, ler também a sessão do subagente.

O custo é `usage.cost.total`, calculado pelo pi com os preços do `models.json` no instante da chamada.
Modelo local (llamacpp) sai com custo 0, a não ser que o Auditor configure `cost` para ele no `models.json` do pi.
Os custos realizados fora da Fabriquinha seguem a 3.4.

### 3.2 Janela da execução

A sessão principal de um ticket é compartilhada por todas as suas execuções autônomas e interativas (F4, 5.1).
A consulta é um fork: o pi copia as entradas da sessão principal para o arquivo novo mantendo o `timestamp` original (conferido em `SessionManager.forkFrom` do pi).
Por isso uma entrada pertence à execução cuja janela `[iniciadaEm, terminadaEm]` contém o seu `timestamp`, e as entradas copiadas caem fora da janela da consulta.
As execuções de um ticket nunca se sobrepõem (índice único do F2), então a atribuição não é ambígua.

### 3.3 Coleta

`coletarUso(banco, execucao)`:

1. Exige a execução terminada.
2. Lê o arquivo linha a linha.
   Linha que não é JSON válido é ignorada: a última pode estar pela metade quando o pi foi morto.
3. Filtra pela janela (3.2) e soma por provedor + modelo.
4. Numa transação, apaga as linhas de `uso` da execução e insere as novas.

A coleta é idempotente: rodar de novo dá o mesmo resultado.
O F4 a chama logo depois de C6, inclusive para órfãs.
Se ela falhar, o F4 anota no log da execução e segue, porque o relatório recoleta tudo antes de gerar (6.1).
Sessão inexistente não é erro: a execução fica sem linhas em `uso` e aparece em `execucoesSemSessao`.

### 3.4 Custos realizados fora da Fabriquinha

A evidência `custos_realizados` da demanda (F3, 4.1) traz tokens por sessão de ferramenta e por provedor e modelo, medidos pelo plugin do harness.
Ela é gravada em `uso_externo` no mesmo C17, e congela no envio da demanda (C25).

- **Custo:** a linha do pi traz o custo pronto e ele vale como veio; nas demais, o F6 calcula com a tabela de preços.
- **Tabela de preços:** os preços do registro de modelos do pi, para o provedor e o modelo da linha.
  ponytail: uma fonte de preço só; se um modelo do Claude Code ou do Codex faltar no registro do pi, a tabela própria editável no web entra.
- **Sessão única:** o par (ferramenta, sessão) pertence à primeira demanda que o submeteu.
  A demanda seguinte que submete o mesmo par grava as linhas com tokens e custo zero e a referência à primeira, para que o total do mês não conte a sessão duas vezes.
- **Janela:** a sessão inteira do harness, até o instante do envio.
- **Demanda recusada:** os custos continuam somados (M2).

O Cursor fica fora: no plano individual ele não guarda tokens localmente.

## 4. Retrabalho

### 4.1 Ideia

Uma linha pertence ao ticket cujo commit a escreveu (`git blame`).
Quando um commit posterior remove ou reescreve essa linha, ela conta como alteração posterior do ticket de origem.
O commit posterior pode ser de outro ticket (4.2) ou de uma pessoa, na branch base (4.4).
Isso funciona entre issues porque o merge commit (D5) preserva na branch base os commits de cada ticket, e cada ticket tem um commit só (D4).

### 4.2 Algoritmo

O F5 chama `registrarRetrabalho(banco, ticket, sha)` depois do commit de cada ticket de desenvolvimento.
Com `P` = primeiro pai do commit, na worktree da issue:

1. `git diff -U0 -M --no-color P <sha>` dá, por arquivo, os intervalos de linhas removidas do lado de `P` (cabeçalho `@@ -início,quantidade`).
   Arquivo removido conta todas as linhas; arquivo renomeado usa o caminho antigo; arquivo binário é ignorado.
2. `git blame --porcelain -L a,b [-L c,d]... P -- <caminho antigo>` dá o commit de origem de cada linha, com um blame por arquivo.
3. O commit de origem vira ticket pela tabela de commits do F5.
   Linha de commit fora da Fabriquinha (humano ou histórico anterior) é ignorada.
4. Numa transação, apaga as linhas de `retrabalho` do ticket e grava uma por ticket de origem.

Linha modificada conta uma vez, pelo lado removido.
Linha só acrescentada não altera código de ninguém e não conta.

Falha em `registrarRetrabalho` nunca reprova o ticket: o F5 anota no log da execução e segue.
Como o cálculo é idempotente, o relatório (6.1) refaz o retrabalho de todos os tickets da issue antes de gerar.

ponytail: mudança só de espaço ou formatação conta como retrabalho.
Se um formatador inflar o número, passar `-w` no diff e no blame.

### 4.3 Leitura

Para cada ticket de desenvolvimento:

- `linhasAdicionadas`: linhas adicionadas no seu commit (F5);
- `linhasAlteradasDepois`: soma de `retrabalho.linhas` com `ticket_origem` igual a ele;
- `linhasAlteradasPorHumanos`: a parte de `linhasAlteradasDepois` que veio de commits humanos (4.4).

### 4.4 Commits humanos

Uma correção feita à mão depois do merge é o sinal mais forte de que o código do agente precisou de retrabalho.

`varrerBase(banco, projeto)`:

1. `git -C <repo> fetch origin <branchBase>`.
2. Lista os commits novos da base, do mais antigo para o mais novo: `git rev-list --no-merges --reverse <cursor>..origin/<branchBase>`.
3. Ignora os que estão em `commit_ticket` (F5): já foram contados em 4.2.
4. Para cada commit restante, aplica os passos 1 a 3 de 4.2 no repositório do projeto, com `P` = primeiro pai.
   Cada ticket de origem encontrado vira uma linha de `retrabalho` com `ticket` nulo, o `sha` do commit e o autor (`git log -1 --format='%an <%ae>'`).
5. Grava o novo cursor (o `sha` de `origin/<branchBase>`) na mesma transação.

| Regra | |
|---|---|
| Cursor inicial | Sem cursor, a chamada só grava o `sha` atual de `origin/<branchBase>` e não conta nada. O F7 chama `varrerBase` logo depois do cadastro (C19), e nada antes disso foi escrito pela Fabriquinha. |
| Merge commits | Ficam de fora (`--no-merges`); os commits que eles trazem aparecem individualmente. |
| Histórico reescrito | Se o cursor deixou de ser ancestral da base (force-push), o F6 recomeça do `sha` atual e anota um aviso. |
| Quando roda | Sempre que o F5 busca a base (criação de worktree, publicação de PR) e uma vez por dia por projeto, pelo agendador (F4). |

ponytail: "humano" é todo commit da base que não é de ticket, então robôs (dependabot, formatador) entram na conta; o autor gravado permite filtrá-los.
Limite: se um PR da Fabriquinha for mergeado com squash pela plataforma, os commits por ticket somem da base e as linhas daquela issue perdem a atribuição (D5).

## 5. Métricas derivadas

### 5.1 Demandas recusadas (M2) e correções no planejamento (M3)

C13, C15 e C28 apagam tickets e entregas, então os ajustes do Auditor no planejamento não deixariam rastro no estado.
Para medi-los, o F2 grava em `comando` uma linha a cada comando aplicado por `comIssue`, na mesma transação (7).
Isso exige que `comIssue` receba o nome do comando e o ator.

| Métrica | Devoluções | Ajustes do Auditor |
|---|---|---|
| M2 | decisões `demanda` recusadas, com a soma do `uso_externo` delas | — (a demanda não volta à IA) |
| M3 | decisões `planejamento` reprovadas | `adicionarTicketDesenvolvimento`, `editarTicket`, `removerTicket`, `adicionarEntrega`, `editarEntrega` e `removerEntrega` com ator `auditor` na fase `aprovacao_planejamento` |

### 5.2 Exigências de alteração (M5)

Tickets de desenvolvimento cujo `origemTicket` é um ticket de revisão da entrega.
O número fica estável depois que a revisão termina: só o agente da própria revisão, durante a execução, ou um C8 dela remove esses tickets (F1, C8 e C13).
As entregas de correção (M8) são contadas à parte, pela origem: o ticket de revisão da demanda ou o de sessão final.

### 5.3 Bugs em arquivos revisados (M6)

Para uma issue X concluída, conta as issues Y que:

- são do mesmo projeto e têm `tipo = problema`;
- foram registradas depois que X foi concluída (`Y.criadaEm > X.concluidaEm`);
- estão concluídas;
- alteraram pelo menos um arquivo que X alterou (arquivos dos commits de cada uma, F5).

A métrica pertence à revisão de X: o arquivo passou pelas revisões das entregas e da demanda e depois precisou de correção.

ponytail: o nível é o de arquivo, como diz o diagrama, e um arquivo muito tocado infla a contagem.
Nível de linha (via `retrabalho`) não pega a correção que só acrescenta código, como um `if` que faltava.

### 5.4 Nota (M7)

A `nota` de cada decisão `pr` de cada entrega e de cada decisão `final` da issue, em ordem.
Uma entrega com PR reprovado e depois aprovado tem duas notas; a demanda reprovada no gate final e depois aprovada também.

### 5.5 Números da demanda e do planejamento

Os números objetivos que o F3 (4.1) atribui ao F6 vêm da demanda e do planejamento aprovado:

- `arquivosPrevistos`: itens de `desenho_solucao.dados.arquivosPrevistos` da demanda;
- `entregasPlanejadas` e `ticketsPlanejados`: entregas e tickets que existiam quando o gate de planejamento foi aprovado;
- `novasDependencias` e `novosAcoplamentos`: tamanhos das listas do `relatorio_impactos_arquitetura` da demanda.

São lidos do JSON da evidência no TypeScript.
É um registro por issue, sem agregação, então não contraria a regra do F2 (3.6).

### 5.6 Apoio por etapa

| Número | Definição |
|---|---|
| execuções | execuções dos tickets da etapa |
| falhas | execuções com `resultado = falha` |
| duração | soma de `terminadaEm − iniciadaEm`; nas etapas interativas inclui o tempo do Auditor |
| reprovações | demanda: C10 recusado; planejamento: C15 reprovado; revisao: decisão de revisão reprovada; encerramento: C16 reprovado; revisao_demanda: decisão reprovada; encerramento_demanda: C29 reprovado |

### 5.7 Visão por mês

Consumo e volume de trabalho por mês, de todos os projetos ou de um só.
É o que o web mostra no início, na página do projeto e na página de métricas (F7, 4.4).
A comparação do mês em foco com a média dos meses anteriores do período é feita pelo web sobre esta lista; o F6 só entrega os meses.

```ts
const Mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);   // AAAA-MM

const MetricasMes = z.object({
  mes: Mes,
  projeto: Slug.nullable(),                                // null = todos os projetos
  consumo: Consumo,                                        // M1 somado: autônomas, interativas e consultas
  modelos: z.array(Consumo.extend({ provedor: z.string(), modelo: z.string() })),
  issues: z.object({ registradas: Inteiro, concluidas: Inteiro }),
  tickets: z.object({ criados: Inteiro, concluidos: Inteiro }),
  prs: z.object({ abertos: Inteiro, mergeados: Inteiro }),
  notaPR: z.object({ media: z.number().min(1).max(5).nullable(), notas: Inteiro }),   // M7; null se não houve nota no mês
  etapas: z.array(Consumo.extend({                         // "Por etapa" da página de métricas
    etapa: Etapa,
    execucoes: Inteiro, falhas: Inteiro, reprovacoes: Inteiro, iteracoes: Inteiro, duracaoMs: Inteiro,
  })),
});
```

| Número | Entra no mês quando |
|---|---|
| `consumo`, `modelos` | a execução dona da linha de `uso` começou no mês (`iniciada_em`) |
| `issues.registradas` / `concluidas` | `criada_em` / `concluida_em` cai no mês |
| `tickets.criados` / `concluidos` | `criado_em` / `concluido_em` cai no mês; tickets apagados (C8, C13, C15) não contam |
| `prs.abertos` | a primeira evidência `pr_aberto` da issue é do mês; as voltas seguintes atualizam o mesmo PR (F5, 5.1) |
| `prs.mergeados` | a decisão `pr` aprovada é do mês |
| `notaPR` | a decisão `pr` com nota é do mês; `media` é a média simples das notas do mês |
| `etapas` | a execução começou no mês; `reprovacoes` segue a 5.6 pela data da decisão; `iteracoes` entra no mês do `em` da iteração, na etapa do ticket (da sessão ou reaberto), e não depende de execução; `duracaoMs` soma as execuções terminadas, e o web divide por `execucoes` para a duração média |

Issues arquivadas contam normalmente: arquivar só tira do board.
O mês é o do fuso do serviço; os instantes continuam em UTC no banco (F2, 3.6).

ponytail: uma execução que vira o mês conta inteira no mês em que começou; a linha de `uso` não tem instante próprio.

ponytail: a média da nota entre meses, feita no web, é a média das médias mensais; um mês com um PR pesa como um mês com dez. Ponderar por `notas` se isso distorcer.

### 5.8 Visão por issue

A tabela "Por issue" da página de métricas: uma linha por issue com pelo menos uma execução iniciada no período.

```ts
const MetricasIssuePeriodo = z.object({
  issue: Id, projeto: Slug, titulo: Titulo.nullable(), fase: Fase,
  consumo: Consumo,                                        // execuções iniciadas no período + custos realizados enviados no período
  consumoPorFase: z.object({                               // custo total da demanda, de qualquer data
    demanda: Consumo, planejamento: Consumo, entregas: Consumo, revisaoDemanda: Consumo,
  }),
  entregas: Inteiro, entregasCorrecao: Inteiro,
  execucoes: Inteiro, falhas: Inteiro, reprovacoes: Inteiro, duracaoMs: Inteiro,
  notasPR: z.array(z.number().int().min(1).max(5)),        // a última nota de PR de cada entrega
  notaFinal: z.number().int().min(1).max(5).nullable(),    // a última nota do gate final
});
```

`fase`, `consumoPorFase`, `entregas`, `notasPR` e `notaFinal` são o estado atual da issue; os demais números contam só o que caiu no período.

## 6. Relatório de produtividade

### 6.1 Geração

`relatorio(banco, issue, entrega?) → { dados, html }` é chamado pelo coletor de produtividade do F3: com `entrega`, depois do pi do encerramento da entrega; sem ela, pelo coletor da árvore × PRs × critérios × custos do encerramento da demanda.
O relatório da entrega cobre as execuções dos tickets dela; o da demanda cobre os custos realizados, o planejamento, todas as entregas e a revisão da demanda.

1. Recoleta o uso de todas as execuções terminadas da issue (3.3) e refaz o retrabalho dos seus tickets de desenvolvimento (4.2).
2. Monta `MetricasIssue` (6.2) com `metricasDaIssue`.
3. Gera o HTML (6.3).

O relatório é uma fotografia: a nota do PR e os bugs posteriores ainda não existem quando ele nasce.
O web mostra os valores atuais (F7).
Cada nova volta de encerramento gera um relatório novo, no seu próprio ticket.

### 6.2 Schema

```ts
const Inteiro = z.number().int().nonnegative();
const Consumo = z.object({
  chamadas: Inteiro,
  tokens: z.object({ input: Inteiro, output: Inteiro, cacheRead: Inteiro, cacheWrite: Inteiro }),
  custo: z.number().nonnegative(),                       // US$, como o pi calculou
});

const MetricasIssue = z.object({
  issue: Id,
  geradoEm: Instante,
  etapas: z.array(Consumo.extend({                       // M1 e apoio; só execuções autônomas e interativas
    etapa: Etapa,
    execucoes: Inteiro, falhas: Inteiro, duracaoMs: Inteiro, reprovacoes: Inteiro,
    modelos: z.array(Consumo.extend({ provedor: z.string(), modelo: z.string() })),
  })),
  consultas: Consumo.extend({                           // M1 das consultas do Auditor (F4, 6.5), fora das etapas
    execucoes: Inteiro,
    modelos: z.array(Consumo.extend({ provedor: z.string(), modelo: z.string() })),
  }),
  demandaRecusada: z.object({ recusada: z.boolean(), custoRealizado: z.number().nonnegative() }), // M2
  correcoesPlanejamento: z.object({ devolucoes: Inteiro, ajustesAuditor: Inteiro }),  // M3
  planejamento: z.object({                                                           // 5.5; null antes do planejamento aprovado
    arquivosPrevistos: Inteiro, entregasPlanejadas: Inteiro, ticketsPlanejados: Inteiro,
    novasDependencias: Inteiro, novosAcoplamentos: Inteiro,
  }).nullable(),
  retrabalho: z.array(z.object({                                                     // M4
    ticket: Id, linhasAdicionadas: Inteiro, linhasAlteradasDepois: Inteiro, linhasAlteradasPorHumanos: Inteiro,
  })),
  arquivosAlterados: Inteiro.nullable(),                                              // arquivos distintos dos commits da issue; null sem commit
  exigenciasRevisao: Inteiro,                                                         // M5
  bugsEmArquivosRevisados: Inteiro,                                                   // M6; 0 antes do merge
  notasPR: z.array(z.number().int().min(1).max(5)),                                   // M7, uma por decisão de PR das entregas
  notasFinal: z.array(z.number().int().min(1).max(5)),                                // M7, uma por decisão final
  entregasCorrecao: Inteiro,                                                          // M8
  decisoes: z.array(z.object({
    gate: z.enum(["demanda", "planejamento", "revisao", "pr", "revisao_demanda", "final"]),
    aprovado: z.boolean(), motivo: z.string().optional(), nota: z.number().int().min(1).max(5).optional(), em: Instante,
  })),
  execucoesSemSessao: z.array(Id),
});
```

### 6.3 HTML

Autocontido, como todo HTML de evidência (F3, 3.3).
Seções, nesta ordem:

1. Resumo: custo total, tokens totais, duração, execuções e falhas.
2. Arquivos alterados: "Arquivos alterados: N", com o selo "acima do limite de 30" quando N > 30, ou "indisponível" quando a issue não tem commit. Só lê; nada barra a issue.
3. Por etapa: execuções, falhas, duração, reprovações, tokens e custo, com as consultas numa linha à parte.
4. Por modelo: etapa × modelo, com chamadas, tokens por tipo e custo.
5. Métricas do diagrama: M2 a M7, cada uma com o valor e a definição em uma linha.
6. Decisões: gate, resultado, motivo e nota, em ordem.
7. Avisos: execuções sem sessão.

ponytail: só tabelas, sem gráfico; gráfico entra quando houver visão entre issues.

### 6.4 Seção 10 do PR

A seção "Autoria e custo" do PR (F3, 4.6) sai de `etapas` do relatório da entrega: modelos, execuções, tokens, custo e reprovações por etapa.
O custo total da demanda fica na árvore × PRs × critérios × custos.
Condensada (F3, 4.7), vira uma linha com a soma das etapas.

## 7. Dados

```sql
CREATE TABLE uso (
  execucao    INTEGER NOT NULL REFERENCES execucao(id),
  provedor    TEXT    NOT NULL,
  modelo      TEXT    NOT NULL,
  chamadas    INTEGER NOT NULL CHECK (chamadas >= 1),
  input       INTEGER NOT NULL CHECK (input >= 0),
  output      INTEGER NOT NULL CHECK (output >= 0),
  cache_read  INTEGER NOT NULL CHECK (cache_read >= 0),
  cache_write INTEGER NOT NULL CHECK (cache_write >= 0),
  custo       REAL    NOT NULL CHECK (custo >= 0),          -- US$, como o pi calculou
  PRIMARY KEY (execucao, provedor, modelo)
);

CREATE TABLE retrabalho (
  commit_alterador TEXT    NOT NULL,                       -- commit que alterou as linhas
  ticket           INTEGER REFERENCES ticket(id),          -- ticket desse commit; nulo em commit humano (4.4)
  autor            TEXT,                                   -- só em commit humano
  ticket_origem    INTEGER NOT NULL REFERENCES ticket(id), -- ticket que tinha escrito as linhas
  linhas           INTEGER NOT NULL CHECK (linhas >= 1),
  PRIMARY KEY (commit_alterador, ticket_origem),
  CHECK (ticket IS NULL OR ticket <> ticket_origem),
  CHECK ((ticket IS NULL) = (autor IS NOT NULL))
);
CREATE INDEX ix_retrabalho_origem ON retrabalho(ticket_origem);

-- Cursor da varredura de commits humanos (4.4).
CREATE TABLE varredura_base (
  projeto    TEXT PRIMARY KEY REFERENCES projeto(nome),
  ultimo_sha TEXT NOT NULL CHECK (length(ultimo_sha) IN (40, 64)),
  em         TEXT NOT NULL
);

-- Gravada pelo F2 em comIssue, na transação do comando.
CREATE TABLE comando (
  id    INTEGER PRIMARY KEY,
  issue INTEGER NOT NULL REFERENCES issue(id),
  nome  TEXT    NOT NULL,                                       -- nome do comando do F1, ex.: editarTicket
  ator  TEXT    NOT NULL CHECK (ator IN ('auditor','agente','fabriquinha','externo')),
  fase  TEXT    NOT NULL CHECK (fase IN (<Fase>)),            -- fase da issue antes do comando
  em    TEXT    NOT NULL
);

-- Gravada pelo F4 (registrarIteracao) a cada ação do Auditor que chama o agente: iteração humana.
CREATE TABLE iteracao (
  id     INTEGER PRIMARY KEY,
  ticket INTEGER NOT NULL REFERENCES ticket(id),            -- ticket da sessão ou o reaberto
  tipo   TEXT    NOT NULL CHECK (tipo IN ('mensagem','dialogo','reabertura')),
  em     TEXT    NOT NULL
);
```

```sql
-- Custos realizados da demanda (3.4), gravados com a evidência custos_realizados.
CREATE TABLE uso_externo (
  ticket      INTEGER NOT NULL REFERENCES ticket(id),        -- o ticket de demanda
  ferramenta  TEXT    NOT NULL CHECK (ferramenta IN ('pi','claude-code','codex')),
  sessao      TEXT    NOT NULL,
  provedor    TEXT    NOT NULL,
  modelo      TEXT    NOT NULL,
  input       INTEGER NOT NULL CHECK (input >= 0),
  output      INTEGER NOT NULL CHECK (output >= 0),
  cache_read  INTEGER NOT NULL CHECK (cache_read >= 0),
  cache_write INTEGER NOT NULL CHECK (cache_write >= 0),
  custo       REAL    NOT NULL CHECK (custo >= 0),           -- US$: do pi, ou calculado pela tabela de preços
  primeira    INTEGER REFERENCES ticket(id),                 -- a demanda que já contou esta sessão; linha zerada
  PRIMARY KEY (ticket, ferramenta, sessao, provedor, modelo),
  CHECK (primeira IS NULL OR (input + output + cache_read + cache_write = 0 AND custo = 0))
);
```

Todas entram no arquivo de schema do F2 (F2, 3.7).
`retrabalho` só aponta para tickets de desenvolvimento com commit, que já estão concluídos e nunca são apagados.
`iteracao` não tem backfill: o que veio antes dela fica com 0. O tipo fica gravado, mas as telas mostram o total.
Refazer o retrabalho de um ticket (4.2) apaga e regrava as linhas em que ele é o `ticket` alterador; as linhas humanas só mudam pela varredura (4.4).

## 8. Interface do módulo

| Função | Quem chama |
|---|---|
| `coletarUso(banco, execucao)` | F4, depois de C6, inclusive para órfãs |
| `registrarRetrabalho(banco, ticket, sha)` | F5, depois do commit de cada ticket de desenvolvimento |
| `registrarIteracao(banco, ticket, tipo)` | F4, depois que a ação do Auditor deu certo: mensagem à sessão interativa (inclusive a que a retoma), resposta a diálogo dela e reabertura C9 |
| `varrerBase(banco, projeto)` | F7, logo depois do cadastro do projeto; F5, depois de buscar a base; F4, uma vez por dia por projeto |
| `metricasDaIssue(banco, issue) → MetricasIssue` | `relatorio` |
| `metricasPorMes(banco, { projeto?, de, ate }) → MetricasMes[]` | F7 (web): um item por mês, de `de` até `ate` |
| `metricasPorIssue(banco, { projeto?, de, ate }) → MetricasIssuePeriodo[]` | F7 (web), página de métricas |
| `relatorio(banco, issue) → { dados, html }` | F3, coletor de produtividade |

## 9. O que o F6 pede aos outros módulos

| Módulo | Pedido |
|---|---|
| F2 | Tabela `comando` e a gravação em `comIssue`, que passa a receber o nome do comando e o ator. |
| F4 | Chamar `coletarUso` depois de cada C6; chamar `varrerBase` uma vez por dia por projeto; chamar `registrarIteracao` em `enviar` e `responderNaSessao` (só em sessão interativa) e em `reabrir`. Não gravam: steer e follow_up em sessão autônoma, consulta, decisões de gate, C24 e o prompt inicial. |
| F5 | Tabela de commits (sha → ticket) e de arquivos por commit com linhas adicionadas e removidas; chamar `registrarRetrabalho` depois de cada commit de ticket e `varrerBase` depois de buscar a base. |

## 10. Verificação

- Coleta: sessão JSONL de exemplo com mensagens de dois modelos, `toolResult` com `usage`, `compaction` com `usage`, entrada fora da janela e última linha cortada.
  Confere as somas por modelo e que rodar duas vezes dá o mesmo resultado.
- Sessão compartilhada: duas execuções interativas na mesma sessão recebem cada uma só as suas entradas.
- Retrabalho, num repositório git temporário: o ticket A cria um arquivo; o ticket B reescreve 3 linhas e acrescenta 5; espera `retrabalho(B, A, 3)`.
  Casos à parte: arquivo removido, renomeado e binário, e linha de commit humano.
- Commits humanos: na base, um commit sem ticket reescreve 2 linhas do ticket A; espera `retrabalho(commit, null, autor, A, 2)` e o cursor avançado.
  Um merge commit não gera linha; um force-push que tira o cursor da história gera aviso e recomeça.
- Bugs: issue `problema` registrada depois do merge de outra e tocando um arquivo dela conta 1; uma `funcionalidade` no mesmo arquivo não conta.
- Correções: o Auditor cria um ticket, remove outro e reprova o planejamento uma vez; espera `devolucoes = 1` e `ajustesAuditor = 2`.
- Relatório: `dados` passa no schema e o HTML não tem `src` nem `href` externos.
- Visão por mês: uma execução de 31/01 conta em janeiro; um PR aberto em janeiro e atualizado em fevereiro, depois de reprovado, conta um aberto só, em janeiro; um ticket removido no desenho não conta; o filtro por projeto exclui as issues do outro.

## 11. Fora de escopo

- Visão entre issues além da 5.7 e da 5.8, como M2 a M6 por mês ou etapa × modelo ao longo do tempo.
  As tabelas permitem consultar direto no SQLite; entra no F7 quando for pedida.
- Atribuir a modelo as métricas de qualidade (M2 a M7).
  Só tokens e custo saem por modelo.
- Uso do contexto da sessão (F4, seção 11).

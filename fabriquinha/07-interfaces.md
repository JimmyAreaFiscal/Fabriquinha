# F7 — Interfaces

Sistema: Fabriquinha.
Depende de: F1 (comandos, atores e erros), F2 (leituras e arquivos), F3 (submissão e exibição de evidências), F4 (serviço, sessões, chat e configuração), F5 (cadastro de projeto, merge e limpeza), F6 (métricas e varredura da base).
Usado por: o Auditor (navegador) e o agente (bash dentro da sessão pi, guiado pelo pacote P1).

## 1. Responsabilidade

- Expor os comandos do F1 a quem pode pedi-los, e só a quem pode.
- Dar ao agente um CLI com saída estável e erros que dizem o que corrigir.
- Dar ao Auditor um web onde ele faz tudo: configurar, registrar necessidades, acompanhar e conversar com as sessões, ver as evidências e decidir os gates.

O F7 não tem regra de negócio.
Ele resolve o ator, converte a entrada, chama o comando e traduz o erro.

## 2. Divisão entre CLI e web

| Onde | Para quê | Quem |
|---|---|---|
| CLI | Consultar e registrar o trabalho do próprio ticket. | agente, com `FABRIQUINHA_EXECUCAO` |
| CLI | Subir o serviço e abrir o web. | sistema operacional e Auditor (`servidor`, `abrir`) |
| Web | Toda operação do Auditor: configuração, projetos, registro, sessões e chat, evidências, gates, métricas, arquivamento. | Auditor, no navegador, com token |

O CLI não tem nenhum comando de Auditor que mude estado (D9).
Um agente que apague a variável de ambiente não ganha poder de Auditor no CLI: só consegue `servidor` (que não sobe uma segunda instância, F4 2) e `abrir`.

## 3. CLI

### 3.1 Ator

| Situação | O que o CLI aceita |
|---|---|
| `FABRIQUINHA_EXECUCAO` presente | Os comandos da tabela 3.2 permitidos à etapa do ticket. A execução precisa estar `em_andamento`, senão `ErroDeEscopo` ("a execução E-7 já terminou"). `servidor` e `abrir` são recusados. |
| variável ausente | Só `servidor`, `abrir` e `--help`. Qualquer outro comando sai com `ErroDeEscopo`: "este comando é do agente; o Auditor usa o web". |

O F1 confere o escopo de cada comando (próprio ticket, própria issue); o CLI só repassa o ator.
As leituras (`issue ver`, `ticket ver`, `evidencia ver`) alcançam a issue do ticket, as issues de que ela depende e as que dependem dela (as `dependentes` da F2), para o desenho refeito ler a issue nova; fora disso, `ErroDeEscopo`.

### 3.2 Comandos

| Comando | F1 | Etapa do agente |
|---|---|---|
| `servidor` | F4, 2 | — (sem a variável) |
| `abrir` | F4, 2 | — (sem a variável) |
| `projeto ver` | leitura | todas |
| `issue ver I-n` | leitura | todas |
| `issue editar I-n [--titulo <t>] [--tipo <funcionalidade\|problema>] [--descricao <arquivo>]` | C2 | registro |
| `issue propor I-n --titulo <t> --arquivos <n> --descricao <arquivo>` | C23 (`--arquivos` inteiro ≥ 0, sem comparação com 30; a regra dos 30 arquivos mora nas skills) | registro, desenho |
| `issue cancelar I-n` | C22 (o agente recebe `ErroDeEscopo`, saída 1; só o Auditor cancela, no web) | desenho, desenvolvimento, revisao, encerramento, registro, sessao |
| `issue dep add I-n I-m` / `issue dep rm I-n I-m` | C3, C4 | registro |
| `ticket ver T-n` | leitura | todas |
| `ticket criar I-n --titulo <t> [--descricao <arquivo>]` | C11 | desenho, revisao, sessao |
| `ticket editar T-n [--titulo <t>] [--descricao <arquivo>]` | C12 | desenho, revisao, sessao |
| `ticket remover T-n` | C13 | desenho, revisao, sessao |
| `revisao decidir T-n aprovar\|reprovar [--motivo <texto>]` | C14 | revisao |
| `evidencia add <tipo> [--dados <arquivo.json>] [--arquivo <caminho>]...` | C17 (F3, 5) | todas, conforme o catálogo |
| `evidencia schema <tipo>` | leitura (F3, 5) | todas |
| `evidencia ver T-n <tipo>` | leitura | todas |

`projeto ver` sem argumento mostra o projeto da execução.
`evidencia ver` devolve o `dados` e o caminho absoluto de cada arquivo no armazenamento do F2, para o agente abrir um HTML ou log com as próprias ferramentas.
O agente não escolhe modelo (C11 e C20 do Auditor ficam no web) nem cria PR (F5, 5.0).

`servidor` sobe o serviço do F4 (seção 2).
`abrir` lê `<raiz>/web.url` e abre o navegador nesse endereço; sem o arquivo, diz que o serviço não está rodando.

### 3.3 Entrada e saída

- Argumentos lidos com `parseArgs` de `node:util`, em modo estrito: opção desconhecida é erro.
- IDs aceitam `I-12` ou `12`; o prefixo, quando vem, precisa ser o do tipo esperado.
- Texto longo (descrição) vem de arquivo, ou de stdin com `-`.
  Assim o agente escreve o Markdown num arquivo e não briga com aspas no shell.
- Saída: um objeto JSON em uma linha no stdout, como no issues-local.
- Erro: a mensagem do F1 (seção 7) em uma linha de texto no stderr.

| Código de saída | Quando |
|---|---|
| 0 | sucesso |
| 1 | `ErroDeRegra`, `ErroDeEscopo` ou falha externa |
| 2 | uso inválido (comando ou opção desconhecida, argumento faltando) |

Uso inválido imprime o trecho de ajuda do grupo de comandos (`issue`, `ticket`...), não a ajuda inteira.

## 4. Web

### 4.1 Servidor e acesso

- Servido pelo próprio `fabriquinha servidor` (F4, 2), com `node:http`, sem framework, só em `127.0.0.1:$FABRIQUINHA_PORTA` (padrão 4317).
  A porta fixa é também a trava de instância única.
- A cada subida, o serviço gera um token de 32 bytes aleatórios (`crypto.randomBytes`).
  Grava `http://127.0.0.1:<porta>/entrar?token=<token>` em `<raiz>/web.url`, com permissão `0600`; `fabriquinha abrir` abre esse endereço.
- `GET /entrar?token=` compara em tempo constante (`crypto.timingSafeEqual`), grava o cookie `fabriquinha` (`HttpOnly`, `SameSite=Strict`, `Path=/`) e redireciona para `/`.
  Reiniciar o serviço invalida o cookie; a página diz para rodar `fabriquinha abrir`.

Guarda aplicada a toda requisição, na ordem:

| Regra | Resposta |
|---|---|
| `Host` diferente de `127.0.0.1:<porta>` (fecha DNS rebinding) | 403 |
| `/api/*` e `/arquivos/*` sem o cookie com o token | 401 |
| mutação (`POST`, `DELETE`) sem `Sec-Fetch-Site: same-origin` (fecha CSRF, o `curl` comum de um agente e o script de um HTML de evidência, que roda em origem opaca) | 403 |

Os arquivos estáticos do cliente (JS, CSS, fontes) ficam em `/static/*` e não exigem token: não carregam dado nenhum.
Todo `GET` fora de `/api/*`, `/arquivos/*`, `/static/*` e `/entrar` devolve o `index.html`, e o cliente escolhe a página pelo caminho (4.4).

### 4.2 Rotas da API

Respostas em JSON, exceto onde indicado.
Corpo das mutações em JSON, até 64 KiB, validado por schema `zod`.
`:sessao` é o `sessaoPi` (F4, 5.1).

**Leitura**

| Rota | O que devolve |
|---|---|
| `GET /api/board` | Issues não concluídas de todos os projetos, para o board do Início (4.4). |
| `GET /api/projetos/:nome/issues?concluidas=&arquivadas=&canceladas=` | Issues do projeto com os seus tickets e as sessões ativas, para a página do projeto (4.4). |
| `GET /api/metricas?projeto=&de=&ate=` | `MetricasMes[]` (F6, 5.7), um por mês de `de` a `ate`, no formato `AAAA-MM`; padrão: os 11 meses anteriores mais o mês corrente; no máximo 24 meses; sem `projeto`, todos. |
| `GET /api/metricas/issues?projeto=&de=&ate=` | `metricasPorIssue` (F6, 5.8): uma linha por issue com execução no período. |
| `GET /api/issues/:id` | Agregado da issue, projeto, metadados das evidências com os arquivos, as sessões dos tickets e avisos de limpeza (F5, 5.3). No gate do desenho traz também `propostas`, as propostas de issue abertas. |
| `GET /api/sessoes?escopo=ativas\|historico&projeto=&issue=&etapa=` | Sessões com estado e motivo (F4, 5.2). |
| `GET /api/sessoes/:sessao` | Metadados da sessão e a conversa até agora (F4, 5.4). No registro interativo traz `propostas`, as propostas de issue abertas do ticket; a mensagem de aviso da Fabriquinha sobre uma proposta decidida vem marcada `aviso`. |
| `GET /api/sessoes/:sessao/eventos` | Server-Sent Events com os eventos do processo vivo e as mudanças de estado (F4, 5.4). |
| `GET /api/sessoes/:sessao/historico.md` | Exportação do histórico em Markdown, como download (F4, 6.8). |
| `GET /api/execucoes/:id/log` e `/prompt` | O `log` e o `prompt.md` da execução (F4, 6.1.2), como texto. |
| `GET /arquivos/:sha256[?baixar]` | Arquivo de evidência (4.3). |
| `GET /api/configuracao` | A configuração do F4 (seção 3) e o estado do agendador (ligado, próxima busca, execuções autônomas em andamento, uma por item). |
| `GET /api/projetos` / `GET /api/projetos/:nome` | Projetos cadastrados. |
| `GET /api/modelos` | Pares provedor + modelo disponíveis, de `pi --list-models`, para os seletores. |

**Configuração e projetos**

| Rota | O que faz |
|---|---|
| `POST /api/configuracao` | Salva a configuração do F4 (seção 3). |
| `POST /api/projetos` | C19: `conferirProjeto` (F5, 2), `conferirModelo` para cada modelo (F4, 9), grava, e chama `varrerBase` (F6, 4.4) para fixar o cursor inicial. |
| `DELETE /api/projetos/:nome` | Remove o projeto e tudo o que depende dele, em qualquer fase: do banco, as issues com tickets, execuções, evidências, decisões e uso (custo); do disco, as pastas de execução, as sessões do pi, os anexos que nenhum outro projeto usa e `<raiz>/worktrees/<projeto>`. O repositório original, as branches `fabriquinha/I-n` e o remoto não são tocados. Recusa com 409 se há execução em andamento no projeto; projeto inexistente dá 404. Devolve `{ avisos }`, um por falha ao apagar no disco (o banco não volta atrás). |

**Registro e issue**

| Rota | O que faz |
|---|---|
| `POST /api/registros` `{ projeto, deps, descricao }` | `registrarNecessidade` (F4, 6.6): C1 com a descrição, que é obrigatória (vazia ou só espaços dá 422 antes de gravar), worktree e sessão interativa. Devolve a sessão para o cliente abrir o chat. |
| `POST /api/issues/:id` `{ titulo?, tipo?, descricao? }` | C2 do Auditor, só na fase `registro`. |
| `POST /api/issues/:id/deps` `{ dep }` / `DELETE /api/issues/:id/deps/:dep` | C3, C4 do Auditor. |
| `POST /api/issues/:id/cancelar` | `cancelarIssue` (F4, cancelamento; C22): a issue e as dependentes, diretas e indiretas, de qualquer projeto. 409 na concluída ou já cancelada, 403 fora do Auditor. |
| `POST /api/issues/:id/registro` `{ aprovado, motivo? }` | C10. Devolver também envia o motivo ao agente como mensagem (F4, 6.6). |
| `POST /api/propostas/:id` `{ aceita }` | `decidirProposta` (F4, 6.6): C24 pelo Auditor. Devolve `{ issue? }`, a issue criada no aceite. 409 se a proposta já foi decidida ou o agente ainda trabalha, 404 se não existe, 422 se `aceita` não é booleano. No registro retoma a IA com o aviso da Fabriquinha; no desenho reprova o desenho (C15). |
| `GET /api/projetos/:nome/heatmap` | Heatmap de alterações da base nos últimos 12 meses (`heatmapDo`, F5 §11): `{ branch, desde, ate, raiz, commits }`, com a árvore inteira de pastas e arquivos. Projeto inexistente dá 404; pasta do repositório ou branch base ausente dá 409 com motivo e correção. |
| `POST /api/projetos/:nome/arquivar` | C18 do projeto; devolve quantas issues foram arquivadas. |

**Tickets e gates**

| Rota | O que faz |
|---|---|
| `POST /api/issues/:id/tickets` `{ titulo, descricao, modelo? }` | C11 do Auditor (fase `aprovacao_desenho`). |
| `POST /api/tickets/:id` `{ titulo?, descricao? }` | C12 do Auditor. |
| `DELETE /api/tickets/:id` | C13 do Auditor. |
| `POST /api/issues/:id/desenho` `{ aprovado, motivo? }` | C15. |
| `POST /api/issues/:id/pr` | Pendente: a decisão do PR é tomada na hospedagem (4.6). |
| `POST /api/tickets/:id/reabrir` `{ instrucao? }` | C9: responder e retomar (F4, 6.4). |
| `POST /api/tickets/:id/modelo` `{ modelo \| null }` | C20, com `conferirModelo` (F4, 9). |
| `POST /api/tickets/:id/executar` | `executarAgora` (F4, 4). |
| `POST /api/tickets/:id/consulta` | `conversarSobre` (F4, 6.5): C21; devolve a nova sessão. |
| `POST /api/tickets/:id/concluir-sessao` | `concluirSessao` (F4, 6.6): C7 da sessão em aberto. |

**Chat**

| Rota | O que faz |
|---|---|
| `POST /api/sessoes/:sessao/mensagens` `{ texto, modo, anexos? }` | `enviar` com `modo` `prompt`, `steer` ou `follow_up` conforme o estado (F4, 5.4); `anexos` são sessões cujo histórico vai junto (`anexarHistorico`, F4, 6.8). |
| `POST /api/sessoes/:sessao/dialogos/:id` `{ valor? \| confirmado? \| cancelado? }` | `responderDialogo` (F4, 5.4). |
| `POST /api/sessoes/:sessao/abortar` | `abortar`. |

**Erros**

| Erro | HTTP |
|---|---|
| `ErroDeEscopo` | 403 |
| ID inexistente | 404 |
| `ErroDeRegra` de estado, inclusive "a I-n já tem a execução E-n em andamento" (C5) | 409 |
| `ErroDeRegra` de schema, corpo inválido | 422, com o caminho de cada campo (`z.prettifyError`) |
| falha do F5 no cadastro | 502, com a saída do comando; nada é gravado |

O corpo de erro é `{ "erro": "<mensagem do F1>" }`, e o cliente a mostra como está.

### 4.3 Arquivos de evidência

- A rota só serve um `sha256` presente em `evidencia_arquivo`; o caminho vem do F2 (`caminhoArquivo`), nunca do cliente.
- `Content-Type` é o `mime` gravado; toda resposta leva `X-Content-Type-Options: nosniff` e `Content-Security-Policy: sandbox allow-scripts` (F3, 3.3).
- `?baixar` acrescenta `Content-Disposition: attachment` com o nome original.
- Suporta `Range` com um intervalo só (resposta 206).
  Sem isso o navegador não consegue avançar num vídeo de até 500 MiB sem baixá-lo inteiro.

O log e o prompt da execução são lidos de `<raiz>/execucoes/E-<id>/`, com o caminho montado a partir do ID inteiro.

### 4.4 Telas

Cliente de página única, no mesmo modelo do issues-local:

- `index.html` e `app.js`, com funções puras de render testáveis em Node sem DOM;
- `markdown-it` com `html: false` para todo texto vindo de agente;
- as fontes e a linguagem visual do issues-local (tema escuro quente, IBM Plex Sans e Mono).

A referência visual de cada página é o protótipo aprovado em `~/Documents/Pessoal/Fabriquinha/prototipos/`, um HTML por página, que usa `base.css` com os tokens do issues-local.
Os números dos protótipos são fictícios.

| Página | Caminho | Protótipo |
|---|---|---|
| Início | `/home`; `/` redireciona para cá | `01-inicio.html` |
| Projeto | `/projects/:projeto`; `/projects` abre o último projeto visto neste navegador, ou o primeiro em ordem alfabética | `02-projeto.html` |
| Heatmap | `/projects/:projeto/heatmap`, a aba Heatmap da página Projeto | — |
| Issue | `/projects/:projeto/issues/:issue` | `03-issue.html` |
| Métricas | `/metrics` | `04-metricas.html` |
| Histórico | `/history` | `05-historico.html` |
| Chat | `/sessions/:sessao` | `06-chat.html` |
| Configuração | `/config` | `07-configuracao.html` |

Navegação fixa no topo: **Início** (com o número de sessões que aguardam o Auditor), **Projetos**, **Métricas**, **Histórico** e **Configuração**.
As páginas usam caminho, com a History API.
Todo link é um `<a href>` de verdade, então qualquer página, inclusive o chat, também abre em outra aba do navegador.
Se o projeto do caminho não for o da issue, o cliente troca o caminho pelo certo, sem recarregar.

Duas peças se repetem entre as páginas:

- **Trilho de fases:** as 8 fases do F1 (menos `concluida`) em linha, agrupadas pelas 5 etapas do processo (Registrar, Desenhar, Implementar, Revisar, Encerrar).
  As fases de gate (`aprovacao_desenho`, `aprovacao_pr`) são losangos; as demais, círculos.
  Fases passadas ficam verdes; a atual fica maior e com a cor do estado: âmbar quando aguarda o Auditor, vermelho em falha, azul quando roda.
- **Caixa:** uma janela sobreposta grande (`<dialog>`) que abre um artefato ou as execuções de um ticket sem sair da página; fecha com Esc ou clicando fora.

**Início** (`/home`) — foco na decisão

1. Cabeçalho com **Registrar necessidade**, que pede projeto, descrição (obrigatória) e dependências e abre o chat do registro.
2. Métricas do mês corrente de todos os projetos (F6, 5.7) numa frase: custo, tokens, issues registradas e concluídas, tickets criados e concluídos, PRs abertos e mergeados, com link para **Métricas**.
3. **Aguarda você:** um card grande por sessão `aguardando_humano` (F4, 5.2), da mais antiga para a mais nova.
   - Cada card: o motivo em destaque, a issue com título, uma frase do que falta, projeto, ticket, etapa, modo e há quanto tempo.
   - Um botão com a ação do motivo, que abre o chat: **Responder e retomar** (falha), **Ver o PR**, **Avaliar desenho**, **Avaliar registro**, **Responder** (conversa ou diálogo).
4. **Rodando:** uma linha por sessão `rodando`, com modo, issue, título e o que o agente está fazendo, ticket e etapa, modelo e tempo; clicar abre o chat.
5. **Board:** as issues não concluídas de todos os projetos, uma coluna por fase, agrupadas sob as 5 etapas; as colunas de gate são hachuradas e marcadas "gate".
   - Cartão: `I-n`, projeto, título (ou "sem título" no registro) e o ticket não concluído, com etapa e status; clicar abre a issue.
   - Marcas no cartão: **aguarda você**, com o motivo; **em execução**, com o tempo decorrido; **bloqueada por I-x**, quando há dependência não concluída.
6. Atualiza sozinha a cada 5 segundos enquanto a aba está visível.

**Projeto** (`/projects/:projeto`) — trilho de fases

1. Cabeçalho: seletor de projeto, link **Editar na Configuração** e **Registrar necessidade**, com o projeto já escolhido.
   Abaixo dele, as abas **Issues** (esta página, ativa) e **Heatmap** (`/projects/:projeto/heatmap`), links de verdade.
2. Métricas do mês corrente só do projeto (F6, 5.7), em 5 cards: custo (com chamadas de LLM), tokens (entrada, saída e cache), issues, tickets e PRs.
3. Barra com a contagem (em andamento, concluídas, arquivadas, canceladas), as opções explícitas **Mostrar concluídas**, **Mostrar arquivadas** e **Mostrar canceladas** (Q2) e **Arquivar concluídas** (C18 do projeto, com confirmação que diz quantas serão arquivadas e que nada é apagado).
4. Cabeçalho das colunas do trilho (etapas e fases) fixo no topo ao rolar.
5. Uma linha por issue: título, `I-n`, tipo, dependência que bloqueia, PR e progresso dos tickets (concluídos/total), o trilho de fases e, à direita, a sessão ativa com estado e link para o chat.
   A cancelada só aparece com **Mostrar canceladas**, apagada, com "cancelada em dd/mm" e o trilho neutro; fica fora de "em andamento" e não bloqueia as que dependem dela.
6. Clicar na linha abre a gaveta com os tickets: etapa, `T-n`, título, status, modelo (★ quando é override do ticket, C20) e sessão.
   As issues que aguardam o Auditor ou falharam já vêm com a gaveta aberta.
7. Atualiza sozinha a cada 5 segundos, como o Início.

**Heatmap** (`/projects/:projeto/heatmap`) — onde o código mais mudou

1. Cabeçalho como o da página Projeto (só o seletor) e as mesmas abas, com **Heatmap** ativa; o item **Projetos** da navegação segue marcado.
2. Barra com a janela de 12 meses até hoje (dd/mm/aaaa), a branch base e o total de alterações do projeto, igual à soma das linhas da raiz.
   Total 0 mostra "Nenhuma alteração nos últimos 12 meses", com todos os totais em 0.
3. A árvore do repositório: uma linha por pasta e arquivo, cada uma um `<details>` com quadrado de cor, nome, total de alterações e barra.
   A cor é `hsl(220·(1−calor) 70% 50%)` (azul frio a vermelho quente), com `calor = ln(1+n)/ln(1+T)`, `n` as alterações da linha e `T` o total do projeto.
   Ordem: mais alterações primeiro, empate por nome.
4. Clicar numa pasta abre e mostra os filhos (o conteúdo é desenhado na primeira abertura, sem nova chamada à API); clicar de novo fecha.
5. Clicar num arquivo mostra "Código alterado: N alterações · quanto maior, pior" (a métrica: mais alterações, pior) e a tabela de commits da janela: hash de 7, mensagem, data e "PR #N" ou "sem PR".
   Arquivo sem alterações na janela mostra 0, na cor mais fria, sem tabela.
6. Projeto inexistente mostra "Projeto não encontrado" como a página Projeto; erro do git (repositório ou branch base ausente) mostra o motivo e a correção sob as abas.
7. Não se atualiza sozinha: cada abertura relê o git.

ponytail: o Início e a página do projeto releem tudo a cada 5 segundos; com centenas de issues ativas, trocar por um contador de versão e só reler quando mudar.

**Issue** (`/projects/:projeto/issues/:issue`) — mesa de trabalho enxuta

Na página ficam só vídeo, cards, tabelas, a descrição e o corpo do PR; o resto abre na caixa.

1. Cabeçalho: caminho (Projetos › projeto › `I-n`), título (com a pílula **Cancelada** quando for o caso) e o trilho de fases; na cancelada o marco da fase em que a issue parou fica neutro.
2. Coluna da esquerda, fixa ao rolar:
   - **Detalhes:** projeto, tipo, criada em, PR (link) e dependências com a fase de cada uma, com adicionar e remover enquanto a issue não estiver concluída nem cancelada (C3, C4); **Cancelada em** quando for o caso.
     No pé do card, **Cancelar issue** (C22) abre um diálogo que diz que a issue sai do andamento e que nada é apagado, e lista os efeitos: os tickets abertos ou que falharam, que serão fechados, a execução em andamento, que será parada, e as dependentes (link, projeto e fase), que serão canceladas junto; **Voltar** ou **Cancelar issue**. Na concluída o botão fica desabilitado, com "A I-n está concluída e não pode ser cancelada."; na cancelada some, e também a **Ação do Auditor**;
   - **Descrição** em Markdown, recolhida com **ver tudo**;
   - **Tickets e sessões:** linha do tempo dos tickets em ordem de criação, com etapa, status e as sessões de cada um (principal e consultas) com link para o chat.
     Clicar no ticket abre na caixa as execuções: modo, resultado, início, duração, custo, erro e links do log e do prompt.
3. Coluna da direita:
   - **Ação do Auditor**, só quando existe: o painel do gate da fase; **Executar agora** para ticket autônomo `aberto` e elegível, desabilitado com o motivo ("a I-n já tem a execução E-n em andamento") só quando a própria issue executa; o aviso de limpeza que falhou (F5, 5.3), com o comando a rodar.
   - **Artefatos:** uma linha por etapa e ticket, do mais recente ao mais antigo, com um card pequeno por evidência (classe do conteúdo — HTML, IMG, VÍDEO, TABELA, TEXTO, JSON — nome e um ponto verde ou vermelho quando a evidência tem `aprovada`).
     Clicar abre a evidência na caixa (4.5), com **abrir em nova aba** e **baixar**.
4. As métricas da issue não ficam nesta página: a tabela por issue fica em **Métricas** e o relatório de produtividade é um artefato do encerramento.

A página da issue não se atualiza sozinha, para não apagar o que o Auditor está digitando num gate.

**Painéis de gate**

| Gate | Mostra | Ações |
|---|---|---|
| Registro (`registro`) | Título, tipo, descrição, `comportamento` e a tabela de `criterios_aceite`, e as evidências que faltam. | **Aprovar registro** (C10); **Devolver**, habilitado só com o motivo. |
| Desenho (`aprovacao_desenho`) | 4 cards: arquivos previstos, tickets propostos, acoplamentos novos e impacto na arquitetura (F6, 5.5). Tabela de critérios de aceite. Tabela de tickets de desenvolvimento propostos, cada um com seletor de modelo (padrão da etapa ou override, C20), **Editar** e **Remover**, e **+ Novo ticket** (C11 a C13). As quatro evidências do desenho ficam nos artefatos. Antes da decisão, um **cartão de proposta de issue** por proposta aberta da IA (C23): rótulo "Proposta de issue", `T-n` do ticket que a fez, "~n arquivos estimados · limite de 30 por PR" (em destaque acima de 30), título, mensagem em Markdown sem HTML e a frase do efeito. | **Aceitar** e **Recusar** a proposta (C24, `POST /api/propostas/:id`); **Aprovar desenho** (C15); **Reprovar**, habilitado só com o motivo. |
| PR (`aprovacao_pr`) | Link do PR com o estado na hospedagem, vídeo explicativo, 4 cards de produtividade (custo, tokens, execuções e falhas, reprovações), corpo completo do PR (anexo de `pr_aberto`) em Markdown, tabela de comprovação dos critérios e tabela de fitness functions com explicações. | Nenhuma decisão no web: a revisão, o merge e o pedido de mudanças são feitos no próprio PR, com o botão **Abrir PR**. Como a Fabriquinha fica sabendo da decisão está pendente (4.6). |

**Métricas** (`/metrics`) — mês em foco contra a média

1. Filtros: projeto (ou todos), **De** e **Até** (mês), com padrão nos 11 meses anteriores mais o mês atual e o atalho **últimos 12 meses**.
   Uma frase resume a comparação, por exemplo "comparando out/26 com a média de 11 meses (nov/25 a set/26)".
2. Régua com os meses do período, cada um com uma barra do custo; o mês em foco é o último do período e muda com um clique.
   A média é sempre a dos meses do período anteriores ao mês em foco; o primeiro mês do período não tem média.
3. 6 cards do mês em foco, cada um com o valor, a média dos meses anteriores e a variação em %: custo, tokens, issues concluídas (de quantas registradas), tickets concluídos (de quantos criados), PRs mergeados (de quantos abertos) e nota média dos PRs (de 5, com quantas notas).
   Mês sem nota mostra "—" e fica fora da média.
4. **Evolução por mês** do card escolhido: uma coluna por mês, o mês em foco destacado, os meses da média num tom e uma linha horizontal na altura da média; passar o mouse mostra os valores, clicar numa coluna muda o foco e **ver tabela** troca o gráfico pela tabela.
5. **Por etapa:** tabela do mês em foco contra a média, uma linha por etapa (registro a sessão em aberto): custo em barras duplas com a variação, e tokens, execuções, falhas, reprovações e duração média no formato "mês / média".
6. **Por modelo:** custo e tokens por tipo de cada provedor + modelo no mês em foco.
7. **Por issue:** tabela das issues com execução no período, ordenável pelo cabeçalho: issue (link), título, projeto (só com "todos"), fase, custo, tokens, execuções, falhas, reprovações, duração e nota do PR, com uma linha de total.

As cores dos gráficos seguem a paleta categórica validada para o fundo escuro (azul, laranja e verde-água, nesta ordem); o texto nunca usa a cor da série.

**Histórico** (`/history`) — dias e prévia

1. Filtros: projeto, issue e etapa, com a contagem de sessões.
2. Lista das sessões `terminada` agrupada por dia (Hoje, Ontem, data), da mais recente para a mais antiga.
   Cada linha: hora, `I-n`, `T-n`, título com etapa e modo, resultado (concluída, falha, abortada, cancelada) e custo.
3. Selecionar uma linha mostra ao lado, sem sair da página: issue, ticket e título, projeto, etapa e modo, resultado, quando terminou e quanto durou, custo e modelo, número de mensagens e o fim da conversa.
   Botões **Abrir o chat**, **Conversar sobre** (C21) e **Exportar**.

**Chat** (`/sessions/:sessao`) — conversa + issue

1. Barra de estado: issue (link), ticket, etapa, modo, estado com o motivo e modelo; à direita, a execução atual com **log** e **prompt**, **Exportar** e **Conversar sobre**.
2. Conversa, à esquerda:
   - linhas do sistema (execução iniciada, concluída, diálogo aberto) entre traços;
   - mensagens do agente e do Auditor em Markdown;
   - a mensagem de aviso da Fabriquinha sobre uma proposta de issue decidida, marcada `aviso`, com o rótulo "Fabriquinha";
   - raciocínio recolhido;
   - cada chamada de ferramenta como bloco recolhível: nome, argumentos e um resumo do resultado (por exemplo "✗ 3 de 214"), com a saída em fonte monoespaçada cortada com **ver tudo**;
   - eventos ao vivo pelo SSE, com o texto do agente chegando em fluxo e cursor piscando;
   - rolagem automática para o fim, que pausa quando o Auditor sobe para ler.
   - no registro interativo, entre a conversa e o envio, um **cartão de proposta de issue** por proposta aberta (o mesmo do gate do desenho, abaixo), redesenhado a cada estado;
3. Área de envio, fixa no fim da conversa, conforme o estado (F4, 5.4):
   - rodando: **Redirecionar** (`steer`) ou **Enfileirar** (`follow_up`), **Abortar** e **Enviar**;
   - diálogo de extensão: o pedido do agente com o formulário (`select` como lista de opções, `confirm` como Sim/Não, `input` como texto, `editor` como área de texto), **Cancelar** e **Responder**;
   - falha: o erro em destaque na conversa e, no envio, instrução para a próxima tentativa, seletor de modelo (C20) e **Responder e retomar** (C9);
   - conversa (interativa): **Enviar**; na sessão em aberto, também **Concluir sessão**;
   - gate do registro: o aviso de que a sessão terminou e a decisão está no painel;
   - terminada: só leitura, com **Exportar histórico** e **Conversar sobre esta sessão**.
   Em todo estado que aceita mensagem: **+ Anexar histórico** (seletor de sessões, F4, 6.8), com os anexos como etiquetas removíveis, e a dica "Enter envia · Shift+Enter quebra linha".
4. Coluna da direita:
   - na sessão de registro, o formulário de C2 (título, tipo, descrição) para o Auditor corrigir direto o que o agente registrou; no gate do registro, o painel do gate;
   - o contexto da issue: `I-n` e projeto, o trilho de fases compacto, os tickets da issue com o ticket desta sessão marcado e link para o chat dos outros, os artefatos como cards que abrem na caixa e **Abrir a issue**.

**Configuração** (`/config`) — menu lateral

1. Menu à esquerda: **Geral → Agendador** (com a marca ligado ou desligado) e **Projetos →** um item por projeto, com a hospedagem, e **+ Novo projeto**.
2. À direita, o formulário do item escolhido.
3. Agendador: interruptor, "procurar a cada", "tempo limite da execução" e "parar sessão ociosa após", em minutos (F4, 3), a próxima busca, as execuções autônomas em andamento (uma linha "Executando E-n · I-n · T-n · há …" por item) e **Salvar**.
4. Projeto, com o número de issues ao lado do nome e o botão **Remover** à direita dele, em quatro grupos:
   - **Repositório:** nome (só leitura depois de criado), branch base, caminho absoluto, hospedagem (só leitura, deduzida do remoto pelo F5) e projeto no SonarQube, com a nota de que o token fica em `<raiz>/ambiente`;
   - **Preparação e testes:** listas de comandos com adicionar e remover; preparação opcional, testes com pelo menos um;
   - **Fitness functions:** nome, comando e descrição (até 300), com adicionar e remover;
   - **Modelo por etapa:** um seletor por etapa alimentado por `GET /api/modelos`, com "padrão do pi" apagado quando vazio.
   Rodapé: "Ao salvar, a Fabriquinha confere o repositório, a branch, o remoto e os modelos", **Cancelar** e **Salvar projeto** (ou **Cadastrar projeto**).
   **Remover** (só no projeto já salvo) abre uma confirmação com o nome e o número de issues, avisando que issues, custos e arquivos do projeto serão apagados: **Cancelar** não muda nada, **Remover projeto** envia `DELETE /api/projetos/:nome`. Com sucesso, a tela volta a `/config` e mostra os avisos; com erro (execução em andamento, por exemplo), a confirmação fecha e a mensagem aparece.
5. Erros de validação aparecem ao lado de cada campo, a partir do caminho que o `zod` devolve, e o rodapé diz quantos campos têm erro.

### 4.5 Exibição de evidências

Na página da issue, cada evidência é um card pequeno; o conteúdo abre na caixa:

| Conteúdo | Exibição na caixa |
|---|---|
| arquivo `html` | `iframe` com `sandbox="allow-scripts"` ocupando a caixa, com **abrir em nova aba** e **baixar** |
| arquivo `video` | `<video controls preload="metadata">` |
| arquivo `imagem` | `<img>` no tamanho da caixa, com **abrir em nova aba** |
| arquivo `texto` | o texto em fonte monoespaçada |
| `aprovada` | ponto verde ou vermelho no card e marca "aprovada" ou "reprovada" na caixa |

Os tipos que o Auditor lê para decidir um gate ganham tabela própria, porque explicação para humano não é JSON (princípio 8); quando o tipo também tem HTML, a tabela vem primeiro e o HTML abaixo:

| Tipo | Tabela |
|---|---|
| `criterios_aceite` | id, dado, quando, então |
| `comprovacao_criterios` | id, atendido, como foi verificado e os anexos |
| `relatorio_complexidade` | fluxo, situação, Big-O de antes e de depois (tempo · espaço) |
| `arquivos_alterados` | arquivo, status, linhas +/−, padrão previsto ou "não previsto: motivo" em destaque |
| `matriz_fitness` + `explicacao_fitness` | uma tabela só: nome, resultado, duração e explicação do agente, com o log |
| `execucao_testes` | comando, resultado e duração |
| `relatorio_sonar` | arquivos analisados e issues abertas |

ponytail: os demais tipos aparecem como JSON formatado.
Quando um deles ficar difícil de ler, ganha a sua tabela.

### 4.6 Pendências

- **PR manual:** a aprovação, o merge e o pedido de mudanças são feitos no próprio PR (decisão do Auditor ao prototipar a página da issue).
  Até decidir como a Fabriquinha fica sabendo da decisão, ficam em aberto: a rota `POST /api/issues/:id/pr`, o C16 (F1), o `mergearPR` (F5, 5.2), a origem do motivo de um pedido de mudança, o momento da nota de 1 a 5 (M7) e a limpeza depois do merge (F5, 5.3).
- **Gates no chat:** falta decidir se os gates de desenho e de PR aparecem também no chat ou só na página da issue, com um link no chat.
  O gate do registro fica no chat (protótipo `06-chat.html`).

## 5. Leituras

O F7 não cria tabela.
As leituras de tela são estas:

| Leitura | Fonte |
|---|---|
| Board do Início | issues não concluídas; para cada uma, os tickets não concluídos, se há dependência não concluída e o estado das suas sessões (F4) |
| Projeto | issues do projeto, filtradas por conclusão e arquivamento, com os tickets e as sessões ativas (F4) |
| Métricas | `metricasPorMes` (5.7) e `metricasPorIssue` (5.8) do F6 |
| Issue | `agregado(banco, issue)` do F2 e as sessões do F4 |
| Sessões e histórico | `sessoes(filtro)` do F4 |
| Chat | `abrirChat(sessao)` do F4 |
| Arquivos de uma evidência | `arquivosDaEvidencia` do F3 |
| Configuração e projetos | tabela `configuracao` do F4 e `projetos(banco)` do F2 |

## 6. Limites conhecidos

- O agente roda como o mesmo usuário do sistema operacional, com bash.
  Token, cookie e `Sec-Fetch-Site` barram o agente que segue o caminho normal, não um agente decidido a burlar.
  Ele pode ler `web.url`, forjar o cabeçalho com `curl -H` ou escrever direto no SQLite.
  Isolar de verdade pede rodar o pi com outro usuário ou em contêiner (o pi documenta isso em `containerization.md`).
- O web só escuta em `127.0.0.1`: sem acesso de outra máquina.

## 7. Verificação

- CLI:
  - para cada linha da tabela 3.2, uma chamada como agente da etapa certa, como agente de outra etapa e como agente de execução terminada; confere a saída ou o `ErroDeEscopo`;
  - sem a variável, qualquer comando além de `servidor`, `abrir` e `--help` sai com `ErroDeEscopo`;
  - uso inválido sai com 2 e imprime a ajuda do grupo.
- Web, contra um banco real numa raiz temporária, com o pi falso que fala RPC (F4, 12):
  - rota da API sem cookie dá 401; `Host` errado dá 403;
  - mutação com `Sec-Fetch-Site: cross-site` ou sem o cabeçalho dá 403;
  - `sha256` que não pertence a evidência dá 404;
  - arquivo HTML sai com o cabeçalho `sandbox`; `Range` devolve 206 com o trecho certo;
  - **Executar agora** com a própria issue executando dá 409; com outra issue executando, 204;
  - cadastro de projeto com remoto inválido dá 502 com a mensagem do F5, e com campo inválido dá 422 com o caminho do campo;
  - `GET /api/metricas` com `ate=2026-13`, com `de` depois de `ate` ou com mais de 24 meses dá 422;
  - `GET /projects/x/issues/I-1` sem cookie devolve o `index.html`, e a chamada de API da página é que dá 401.
- Cliente: as funções de render escapam texto de agente e não executam HTML de descrição.
- Ponta a ponta num navegador real (Playwright):
  - entrar pelo link de `web.url`;
  - configurar um projeto e ligar o agendador;
  - registrar uma necessidade pelo chat e aprovar o registro;
  - acompanhar uma sessão autônoma ao vivo, redirecioná-la e responder a um diálogo de extensão;
  - responder e retomar um ticket que falhou;
  - aprovar um desenho com um ticket ajustado;
  - (pendente, 4.6) o caminho do PR depois que a decisão na hospedagem for definida;
  - abrir uma consulta pelo histórico com o histórico de outra sessão anexado;
  - abrir um artefato e as execuções de um ticket na caixa, e fechá-la com Esc;
  - em Métricas, mudar o mês em foco e conferir que a média passa a usar só os meses anteriores a ele;
  - conferir que um script dentro de um HTML de evidência não consegue chamar a API;
  - abrir `/projects/<projeto>/issues/<issue>` direto numa aba nova, e com o projeto errado no caminho;
  - arquivar as concluídas de um projeto, conferir que somem da lista e voltam com **Mostrar arquivadas**, e que as de outro projeto continuam como estavam;
  - cancelar uma issue, conferir que sai do projeto e volta apagada com **Mostrar canceladas**, e que os cards de custo e tokens do mês não mudam.

## 8. Fora de escopo

- Métricas entre issues além da visão por mês (F6, 11).
- Acesso remoto e mais de um usuário.
- Anexar arquivo pelo web: evidência é submetida pelo agente (F3, 5).

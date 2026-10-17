# F4 — Execução

Sistema: Fabriquinha.
Depende de: F1 (C5–C10, C21, 3.10), F2 (transações), F3 (coleta antes e depois do pi), F5 (worktree), P1 (instruções de etapa).
Usado por: F7 (telas de sessões, chat, configuração e gates).

## 1. Responsabilidade

- Manter a Fabriquinha rodando como um serviço que, de tempos em tempos, procura trabalho autônomo e o executa, uma execução por issue, em paralelo (D8).
- Gerenciar as sessões do pi: iniciar, conversar, responder diálogos, interromper, retomar e encerrar.
- Dar a cada sessão um estado que diga ao Auditor se ela está rodando, se precisa dele ou se já terminou.
- Recuperar execuções interrompidas quando o serviço reinicia.

O F4 não decide regra de negócio: toda mudança de estado passa pelos comandos do F1.
O próximo trabalho é sempre escolhido pelo agendador, nunca pelo agente (Feedback.txt, item 4).

## 2. O serviço

`fabriquinha servidor` é um processo único e de longa duração que hospeda três coisas:

| Parte | O que faz |
|---|---|
| Web (F7) | Board, sessões, chat, gates e configuração. É a única interface do Auditor. |
| Agendador (seção 4) | De tempos em tempos, procura um ticket autônomo elegível e o inicia. |
| Gerente de sessões (seção 5) | É o único que lança o pi. Guarda as sessões vivas e repassa os eventos ao web. |

- **A porta é a trava de instância única.**
  O serviço escuta em `127.0.0.1:$FABRIQUINHA_PORTA` (padrão 4317); uma segunda instância não consegue abrir a porta e sai com erro.
  Assim, nunca há dois agendadores disputando o mesmo banco.
- **O agendamento mora dentro da Fabriquinha**, não no cron.
  O sistema operacional só mantém o serviço de pé.
  O recomendado é um serviço de usuário do systemd:

```ini
# ~/.config/systemd/user/fabriquinha.service
[Service]
ExecStart=%h/.npm-global/bin/fabriquinha servidor
EnvironmentFile=%h/fabriquinha/ambiente
Restart=on-failure
[Install]
WantedBy=default.target
```

- **Acesso ao web:** a cada subida, o serviço gera um token aleatório e grava a URL com o token em `<raiz>/web.url` (permissão `0600`).
  `fabriquinha abrir` lê esse arquivo e abre o navegador.
  O web troca o token por um cookie `HttpOnly` e `SameSite=Strict`, e toda rota exige esse cookie.

## 3. Configuração

O Auditor configura tudo pelo web; nada de operação fica no terminal (D9).

```ts
const Configuracao = z.object({
  agendadorAtivo: z.boolean().default(false),
  intervaloMin: z.number().int().min(1).max(1440).default(5),
  timeoutMin: z.number().int().min(10).max(1440).default(120),
  ociosidadeMin: z.number().int().min(5).max(1440).default(30),
});
```

| Campo | Regra |
|---|---|
| `agendadorAtivo` | Desligado por padrão: a Fabriquinha só começa a trabalhar sozinha quando o Auditor liga. |
| `intervaloMin` | De quanto em quanto tempo o agendador procura trabalho. |
| `timeoutMin` | Tempo limite de uma execução autônoma; conta só o tempo ativo (6.5). É o botão de calibração para modelos locais lentos. |
| `ociosidadeMin` | Depois desse tempo sem mensagem, o processo de uma sessão interativa é parado; a próxima mensagem a retoma (6.6). |

Também pelo web: cadastro e edição de projetos (C19) e override de modelo por ticket (C20), com a conferência de modelos da seção 9.
Segredos (`SONAR_TOKEN`) continuam no ambiente do serviço (`<raiz>/ambiente`), fora do banco.

## 4. Agendador

A cada `intervaloMin`, se `agendadorAtivo`:

1. Para cada projeto cuja última varredura de commits humanos tem mais de 24 horas, chama `varrerBase` (F6, 4.4); falha só vai para o log.
2. Busca os tickets elegíveis (4.1), um por issue.
3. Para cada um, pede ao gerente de sessões para iniciá-lo: o desenho como sessão interativa (6.6), com a mensagem inicial "Vamos desenhar a solução da issue I-n."; as demais etapas em modo autônomo (6.2). A C5 de cada um roda antes do primeiro `await`; a recusa vai para o log e não para os outros.

Issues diferentes executam em paralelo (D8); dentro de cada issue, uma execução por vez (C5).

O botão **Executar agora** de um ticket (o "Auditor → DesenharSolucao" do diagrama) pula o intervalo, mas respeita a C5 da própria issue: só fica desabilitado, dizendo qual execução está rodando, quando a issue já executa. Execução de outra issue não atrapalha.

### 4.1 Tickets elegíveis

```sql
SELECT min(t.id) AS id FROM ticket t JOIN issue i ON i.id = t.issue
WHERE t.status = 'aberto'
  AND t.etapa IN ('desenho','desenvolvimento','revisao','encerramento')  -- o desenho abre interativo
  AND i.fase = t.etapa                       -- casamento etapa × fase (F1, 4.3)
  AND i.arquivada_em IS NULL
  AND NOT EXISTS (SELECT 1 FROM issue_dep d JOIN issue x ON x.id = d.dep
                  WHERE d.issue = i.id AND x.fase <> 'concluida')
  AND NOT EXISTS (SELECT 1 FROM ticket o LEFT JOIN execucao e ON e.ticket = o.id
                  WHERE o.issue = i.id AND (o.status = 'em_execucao' OR e.resultado = 'em_andamento'))
GROUP BY i.id
ORDER BY i.id;
```

Um ticket por issue, o mais antigo dela, da issue mais antiga à mais nova.
A issue com ticket `em_execucao` ou execução em andamento fica de fora: a C5 a recusaria. Com `issue`, a consulta devolve só o ticket dela (o **Executar agora**).

## 5. Sessões

### 5.1 O que é uma sessão

Uma **sessão** é uma conversa do pi (um `sessaoPi`).
Cada vez que um processo pi roda essa conversa, nasce uma **execução** (F1, 3.6).

| Sessão | Quantas por ticket | Execuções |
|---|---|---|
| **Principal** | uma | Todas as execuções autônomas e interativas do ticket continuam a mesma conversa; por isso o chat mostra todas as tentativas. |
| **Consulta** | zero ou mais | Cópia (fork) da principal, para tirar dúvidas sem tocar na conversa original (6.5). |

### 5.2 Estado da sessão

O estado é calculado; não é gravado.

| Estado | Quando |
|---|---|
| `rodando` | Há execução em andamento e nada esperando o Auditor. Inclui a preparação da worktree e as coletas do F3. |
| `aguardando_humano` | Algum dos motivos abaixo. |
| `terminada` | O ticket está `concluido` e nenhum gate depende dele, ou a issue foi cancelada (6.9). |

| Motivo de `aguardando_humano` | Ação no chat |
|---|---|
| `conversa`: sessão interativa esperando a próxima mensagem do Auditor | Responder. |
| `dialogo`: uma extensão do pi abriu uma pergunta (`select`, `confirm`, `input`, `editor`) | Responder o formulário (5.4). |
| `falha`: o ticket autônomo `falhou` | Ler o erro e **responder e retomar** (6.4). |
| `gate_registro`: o agente enviou o registro (C25) e falta a decisão; conta desde o envio | Na página da issue: aprovar ou devolver (C10). |
| `gate_desenho`: o agente enviou o desenho (C25), e a issue está em `aprovacao_desenho`; conta desde o envio | Na página da issue: ajustar os tickets propostos, aprovar ou reprovar (C11–C13, C15). |
| `gate_pr`: o encerramento foi concluído e a issue está em `aprovacao_pr` | Dar a nota e aprovar ou reprovar o PR (C16). |

O gate de revisão não aparece aqui: quem decide é o agente revisor.

### 5.3 Lista e histórico

- A lista de sessões ativas, na página inicial do web, mostra em cards as sessões `rodando` e `aguardando_humano`, com o motivo, a issue, a etapa e há quanto tempo estão assim.
- Quando a sessão fica `terminada`, ela sai da lista e vai para o **histórico**, onde pode ser filtrada por projeto, issue e etapa.
- Clicar numa sessão, na lista ou no histórico, abre a página do chat (5.4).

A tela em si está no F7; aqui está o que ela consome.

### 5.4 Chat

O chat mostra a conversa inteira da sessão e, se houver processo vivo, os eventos ao vivo.

| Origem do conteúdo | Quando |
|---|---|
| Arquivo JSONL da sessão do pi | Sempre, para o que já aconteceu, inclusive quando não há processo vivo. |
| Eventos do processo, repassados ao navegador por Server-Sent Events | Enquanto há execução em andamento. |

O que o campo de mensagem faz depende do estado:

| Estado da sessão | Enviar mensagem |
|---|---|
| `rodando`, autônoma | `steer` (interrompe e redireciona) ou `follow_up` (entra depois do passo atual), à escolha do Auditor. O botão **Abortar** manda `abort`. |
| `aguardando_humano: conversa` | `prompt`. Se o processo foi parado por ociosidade ou reinício, retoma a sessão antes (6.6). |
| `aguardando_humano: dialogo` | O campo vira o formulário do diálogo; a resposta vai como `extension_ui_response`. |
| `aguardando_humano: falha` | Responder e retomar (6.4). |
| `aguardando_humano: gate_*` | O chat recusa a mensagem e mostra o aviso que leva à página da issue, onde o Auditor decide; o botão **Conversar sobre esta sessão** abre uma consulta (6.5). |
| `terminada` | Somente leitura; o botão **Conversar sobre esta sessão** abre uma consulta (6.5). |

Em qualquer sessão que aceite mensagem, o campo de mensagem tem **Anexar histórico de outra sessão** (6.8).

Os diálogos de extensão aparecem para sessões autônomas também.
Um agente autônomo que pergunta algo pela ferramenta `perguntar` ou por uma extensão do Auditor, por exemplo, para em `aguardando_humano: dialogo` até o Auditor responder.

## 6. Execução do pi

### 6.1 Processo

```
pi --mode rpc
   --session-dir <raiz>/sessoes --session-id <sessaoPi>
   [--provider <provedor> --model <modelo>]              # F1, 3.10
   [--thinking <effort>]                                 # effort da etapa no projeto (F1, 3.3); sem ele, o padrão do pi
   --skill <pacote>/skills/fabriquinha                   # CLI da Fabriquinha, somado às skills do Auditor (P1)
   --append-system-prompt <pacote>/etapas/<etapa>.md     # instruções da etapa (P1)
   -e <pacote>/extensions/guarda.ts                      # bloqueia criação de PR pelo agente (F5, 5.0; P1)
   -e <pacote>/extensions/pergunta.ts                    # ferramenta `perguntar`, no lugar da `ask_user_question` (5.4; P1)
   [--approve | --no-approve]                            # confiança herdada do repositório (6.1.1)
   --exclude-tools ask_user_question[,edit,write,bash]   # `edit,write,bash` só em consulta (6.5)
```

| Escolha | Motivo |
|---|---|
| Modo RPC | É o protocolo do pi para embutir sessões em outra interface: `prompt`, `steer`, `follow_up`, `abort` e diálogos de extensão sobre stdin/stdout. Substitui o `-p --mode json` do D3. |
| Subprocesso, não o SDK no mesmo processo | Uma sessão que trava ou estoura memória não derruba o serviço, e o grupo de processos pode ser morto inteiro. |
| `--append-system-prompt` com a etapa | A instrução fica sempre no contexto; uma skill depende de o modelo decidir lê-la. |
| A configuração do pi do Auditor vale inteira | Settings, skills, extensões, ferramentas, pacotes, prompts e `AGENTS.md`/`CLAUDE.md` carregam como numa sessão aberta pelo Auditor. O que ele mudar no pi vale a partir da próxima execução; um processo já vivo segue com a configuração de quando subiu. A Fabriquinha só **soma** a skill do CLI e as instruções da etapa. |
| Nenhuma flag que desligue recurso do Auditor | Nada de `--no-skills`, `--no-extensions` ou `--tools`. Até a consulta restringe só as ferramentas embutidas de escrita, e mantém as que vêm de extensões. A única exceção é `--exclude-tools ask_user_question`: a ferramenta pessoal do Auditor falha no modo RPC (`askWithDialogs is not defined`), e o pi não inicia com duas ferramentas de mesmo nome, então a `perguntar` do pacote P1 toma o lugar dela. |

#### 6.1.1 Confiança do projeto

A worktree fica fora do repositório (F5), então o pi não acha nela a decisão de confiança que o Auditor salvou para o repositório em `~/.pi/agent/trust.json`.
Sem decisão, o modo RPC ignora os recursos locais do projeto (`.pi/settings.json`, extensões e skills do repositório) quando `defaultProjectTrust` é `ask` ou `never`.

Para a execução se comportar como uma sessão do Auditor no repositório, o F4 herda a decisão:

| Decisão mais próxima para `projeto.repo` (o próprio caminho ou um pai) em `trust.json` | Flag |
|---|---|
| `true` | `--approve` |
| `false` | `--no-approve` |
| nenhuma | nenhuma; vale o `defaultProjectTrust` do Auditor |

#### 6.1.2 Processo e ambiente

- O processo roda num grupo próprio; matar o grupo derruba também os testes, servidores e navegadores que o agente abriu.
- O F4 lê o stdout em JSONL dividindo só em `\n`.
  O `readline` do Node não serve: ele também quebra em `U+2028` e `U+2029`, que são válidos dentro de strings JSON (documentação do RPC do pi).
- `cwd` é a worktree da issue (F5); em consulta de issue já concluída, é o repositório do projeto.
- Ambiente: `FABRIQUINHA_EXECUCAO`, `FABRIQUINHA_ROOT` e `FABRIQUINHA_SAIDA` (`<raiz>/execucoes/E-<n>/saida`), como antes.
- Sem credencial de hospedagem (F5, 5.0): `GH_CONFIG_DIR` e `AZURE_CONFIG_DIR` apontam para diretórios vazios da execução, e `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `AZURE_DEVOPS_EXT_PAT` e `SYSTEM_ACCESSTOKEN` são removidas do ambiente do pi.
- `<raiz>/execucoes/E-<n>/` guarda `prompt.md` (o primeiro prompt enviado) e `log` (os passos do F4 com horário e o stderr do pi).

### 6.2 Execução autônoma

1. C5 `iniciarExecucao` em modo autônomo, numa transação; perder a corrida para outra execução é silencioso.
2. Garante a worktree (F5) e roda `antesDoPi` (F3).
3. Lança o pi e envia o prompt da etapa (6.3).
4. Espera o evento `agent_settled`: a execução está completamente assentada, sem nova tentativa, compactação ou mensagem na fila.
5. Sucesso exige que a última mensagem do assistente não tenha `stopReason` de erro ou aborto.
6. Para o processo, grava C6, roda `depoisDoPi` (F3) e chama C7.
   Qualquer falha em qualquer passo leva a C8 com uma mensagem que diz o que faltou.

Depois de **todo** C6, em qualquer modo e também no reinício do serviço (seção 7), o F4 chama `coletarUso` (F6, 3.3).
Falha na coleta só vai para o log: métrica nunca bloqueia o fluxo.

### 6.3 Prompt

O prompt é Markdown (passagem de contexto, princípio 8), montado a partir do agregado da issue.
Ele traz o contexto; o modo de trabalhar fica nas instruções da etapa (P1).

| Etapa | Contexto no prompt |
|---|---|
| todas | Projeto, issue (título, tipo, descrição), ticket (título, descrição), worktree, diretório de saída. Se houver `ticket.instrucao` (6.4), ela vem primeiro. |
| registro | Só o projeto e as dependências informadas; o resto vem da conversa com o Auditor. |
| desenho | Critérios de aceite e o resumo do comportamento. A reprovação (C15) chega como mensagem na mesma sessão (6.6). |
| desenvolvimento | Resumo do desenho aprovado, arquivos previstos, fora do escopo, critérios de aceite e os tickets já concluídos. |
| revisao | Critérios de aceite, desenho aprovado, resumo do `arquivos_alterados` e da `matriz_fitness` coletados antes do pi, e os tickets concluídos. |
| encerramento | Resumo do desenho, das revisões e dos tickets; se o PR já existe, o motivo da última reprovação. |
| sessao | Motivo da reprovação do PR (descrição do ticket) e a URL do PR. |

O prompt nunca fala em outros tickets nem em "continuar trabalhando".

### 6.4 Responder e retomar

Quando um ticket autônomo falha, o Auditor lê o erro e a conversa no chat e escreve uma resposta.

1. C9 `reabrirTicket(ticket, instrucao)` grava a resposta em `ticket.instrucao` e devolve o ticket a `aberto`.
2. O agendador (ou o botão Executar agora) inicia uma nova execução na **mesma** sessão do pi.
   O prompt começa pela instrução do Auditor.
3. C5 consome a instrução (a mensagem já está na conversa do pi).

A instrução fica no banco até ser consumida, então nem um reinício do serviço nem a issue ocupada a perdem.

### 6.5 Consulta

**Conversar sobre esta sessão** abre uma **consulta** (C21): uma sessão nova que começa com todo o histórico da sessão principal do ticket.

- É criada com `pi --mode rpc --fork <sessão principal>`.
  O pi copia a conversa para um arquivo novo, e o F4 lê o novo `sessionId` pelo comando RPC `get_state` e grava na execução.
  A sessão principal não recebe nenhuma mensagem da consulta.
- Sem as ferramentas embutidas que alteram arquivos (`--exclude-tools edit,write,bash`, além da `ask_user_question`): a consulta pergunta, não altera.
  As ferramentas das extensões do Auditor continuam disponíveis; se alguma delas escrever, é escolha dele.
- Não muda o estado do ticket nem da issue e não ocupa a issue.
- Aparece na lista como "Consulta sobre T-n" e segue os mesmos estados das outras sessões.
- O custo entra nas métricas da issue, separado como consulta.
  O F6 conta só o que foi acrescentado depois da cópia, para não contar o histórico duas vezes.
- Para conversar com base em mais de uma sessão, anexe o histórico das outras (6.8).

### 6.6 Sessões interativas e ociosidade

- **Registro:** o botão **Registrar necessidade** pede o projeto, a descrição da necessidade (obrigatória) e as dependências.
  Ele dispara C1 com a descrição, que vai ao prompt da primeira mensagem na seção "Descrição da issue", e a preparação da worktree (F5), abre o chat e envia a mensagem inicial "Vamos registrar uma necessidade no projeto X (issue I-n)".
  A partir daí é conversa: a IA questiona a necessidade e constrói os critérios com o Auditor, e envia o registro (C25) só com o "sim" dele.
- **Desenho:** o agendador ou o **Executar agora** abre a sessão interativa do ticket de desenho, com o contexto da etapa e a mensagem "Vamos desenhar a solução da issue I-n.".
  A IA estuda o código sozinha e leva ao Auditor, na conversa, cada decisão relevante; envia o desenho (C25) só com o "sim" dele.
- **Gate do registro e do desenho (`decidirGate`):** a decisão é na página da issue.
  O F4 para o pi ocioso; aprovado, descarta o que a sessão deixou na worktree (o protótipo do desenho, F3 §7) e grava C10 ou C15; devolvido, grava a decisão com o motivo e retoma a **mesma** sessão com a mensagem "O Auditor devolveu o registro. Motivo: …" ou "O Auditor reprovou o desenho. Motivo: …".
- **Proposta de issue (C23, C24):** a IA do registro ou do desenho propõe dividir a issue (`fabriquinha issue propor`), e o Auditor só aceita ou recusa; `decidirProposta(proposta, aceita)` confere que a proposta está pendente no gate atual e recusa antes de gravar se não estiver.
  - **Retomada única por lote:** o F4 sempre para o pi ocioso (recusa se o agente ainda trabalha) e grava C24, mas só a decisão que deixa o gate sem proposta aberta retoma a IA, uma vez, com o lote; as anteriores só avisam a sessão. Enquanto há proposta aberta no gate, `decidirGate` (Aprovar e Devolver do registro; Aprovar e Reprovar do desenho) recusa com 409 antes de parar o pi.
  - **No registro**, a decisão é no chat. Fechado o lote, o F4 retoma a sessão com o aviso do lote: o da proposta, se for uma só; senão, "O Auditor decidiu as suas propostas de issue:" e uma linha `- P-n: <aviso da proposta>` por proposta.
    O aviso de aceite diz: "A Fabriquinha criou a I-n («título») a partir da sua proposta, que o Auditor aceitou; ela depende da I-m. Reduza o escopo da I-m: …". O de recusa: "O Auditor recusou a sua proposta de issue «título»…".
    A IA ajusta a issue e as evidências na mesma sessão.
  - **No desenho**, a decisão é no gate, na página da issue. Fechado o lote (aceites, recusas ou os dois), o C24 grava o desenho reprovado (C15) com o motivo que lista as decisões, e o F4 retoma a sessão do desenho com esse motivo. Antes disso o gate continua aberto.
  - No aceite, nos dois casos, o F4 abre o registro da issue nova (mesma sessão interativa de **Registrar necessidade**, com a descrição que veio da mensagem da proposta).
- **Sessão em aberto:** aparece sozinha como `aguardando_humano: conversa` quando o PR é reprovado (C16).
  A mensagem inicial traz o motivo e a URL do PR.
  Quando o Auditor clica em **Concluir sessão**, o F4 chama C7, que exige pelo menos um ticket de desenvolvimento criado.
- **Ociosidade:** depois de `ociosidadeMin` sem mensagem, o processo de uma sessão interativa ou de consulta é parado, e C6 grava sucesso.
  O ticket continua como estava, e a sessão continua na lista como `aguardando_humano: conversa`.
  Quando o Auditor volta e manda uma mensagem, uma nova execução retoma a mesma sessão **no mesmo modo**: uma sessão interativa volta interativa, com todas as ferramentas, e o Auditor responde normalmente.
  Retomar depois de ociosidade nunca vira consulta; consulta é só o que o Auditor abre de propósito (6.5).
- Uma sessão com diálogo de extensão pendente não é parada por ociosidade: parar perderia a pergunta.

### 6.7 Tempo limite

- Vale só para execução autônoma e conta só o tempo ativo.
  O tempo em que a sessão espera um diálogo do Auditor não conta.
- Ao estourar `timeoutMin`: `SIGTERM` no grupo, 10 segundos de espera, `SIGKILL`, e C8 com "tempo limite de N min".

### 6.8 Histórico como contexto

O histórico de qualquer sessão, ativa ou do histórico, pode ser levado para outra conversa.

- **Exportar histórico:** baixa a conversa em Markdown (passagem de contexto, princípio 8), gerada pela Fabriquinha a partir do JSONL da sessão.
  O arquivo traz:
  - cabeçalho com projeto, issue, ticket, etapa, modelo e datas;
  - mensagens do Auditor e do agente, na íntegra;
  - cada chamada de ferramenta com o nome e os argumentos;
  - os resultados das ferramentas, cortados em 2.000 caracteres.

  ponytail: o corte é fixo; se algum resultado longo fizer falta, aumentar o limite.
- **Anexar histórico de outra sessão:** no campo de mensagem, o Auditor escolhe uma ou mais sessões.
  O F4 grava a exportação de cada uma em `$FABRIQUINHA_SAIDA/historico-T-<n>.md` da execução atual.
  A mensagem enviada ganha uma linha por anexo: "Histórico da sessão T-n (I-m, etapa) em `<caminho>`; leia antes de responder."
  O agente lê o arquivo sob demanda, então um histórico longo não estoura o contexto de uma vez.

### 6.9 Cancelamento da issue

O Auditor cancela a issue (C22, F1), e o cancelamento atinge também as dependentes, diretas e indiretas.
O serviço `cancelarIssue` roda nesta ordem:

1. Confere o C22 (Auditor, issue não concluída nem cancelada), antes de tocar em qualquer pi.
2. Para cada execução `em_andamento` da issue e das dependentes, `pararParaCancelar`: marca a execução como cancelada, responde `cancelled` aos diálogos pendentes e para o pi como no encerramento (6.6), esperando o processo sair.
3. Grava o C22 de todas numa transação. A execução termina em `falha` com `CANCELADA`, e o ticket que ela rodava fica `cancelado`.
4. Para cada execução que terminou: coleta o uso como depois de qualquer C6 (F6 §3.3), anota "E-n cancelada com a I-n pelo Auditor" no log e avisa quem assina a sessão.

A execução marcada não grava mais nada:

- `rodarExecucao` não lança o `pi --version` nem o pi dela e devolve `CANCELADA`; a marca é conferida depois do prompt e depois do `pi --version`.
- A autônoma não grava C6, C7 nem C8 depois do pi, e a interativa não grava o C6 dela: o cancelamento já gravou o término, e a guarda do C22 recusaria o resto.
- A sessão de uma issue cancelada é `terminada` (5.2), a principal e as de consulta.

ponytail: as execuções marcadas ficam num `Set` em memória que só cresce; são poucos IDs por dia, e o reinício do serviço o esvazia (7).

## 7. Reinício do serviço

O gerente de sessões é o único que lança o pi, então toda execução `em_andamento` encontrada quando o serviço sobe pertence a uma instância anterior.

Na subida, antes de abrir o web e o agendador, para cada execução `em_andamento`:

1. `SIGKILL` no grupo `pgid_pi`, se ainda existir.
2. C6 com falha "serviço reiniciado".
3. Autônoma: C8, e o ticket aparece como `aguardando_humano: falha`.
   Interativa: o ticket continua `em_execucao`, e a próxima mensagem retoma a sessão (6.6).
   Consulta: só o C6.

As execuções simuladas pendentes (F8 5.5) seguem a mesma lógica: `SIGKILL` no grupo do `pgid` e `falhou` com "serviço reiniciado".

ponytail: a instância única garantida pela porta torna desnecessário conferir PID e instante de início de processo.

## 8. Fluxo completo de uma issue no web

```mermaid
sequenceDiagram
    actor A as Auditor
    participant W as Web
    participant G as Gerente de sessões
    participant S as Agendador
    A->>W: Registrar necessidade
    W->>G: sessão interativa (registro)
    A->>W: conversa no chat; a IA envia o registro
    A->>W: Aprovar registro na página da issue
    S->>G: desenho (interativo)
    A->>W: decide junto na conversa; a IA envia o desenho
    G-->>W: sessão aguardando_humano: gate_desenho
    A->>W: ajusta tickets, aprova na página da issue
    S->>G: desenvolvimento, um ticket por vez
    S->>G: revisão, encerramento
    G-->>W: sessão aguardando_humano: gate_pr
    A->>W: nota e aprovação do PR
```

## 9. Conferência de modelos

No cadastro de projeto (C19) e no override de modelo (C20), o F4 confere cada par com `pi --list-models "<provedor>/<modelo>"` e exige correspondência exata na saída.
Um modelo inexistente é recusado no formulário, não no meio de uma execução.

## 10. Dados

```sql
-- Configuração do serviço (seção 3): linha única.
CREATE TABLE configuracao (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  agendador_ativo  INTEGER NOT NULL DEFAULT 0 CHECK (agendador_ativo IN (0,1)),
  intervalo_min    INTEGER NOT NULL DEFAULT 5   CHECK (intervalo_min BETWEEN 1 AND 1440),
  timeout_min      INTEGER NOT NULL DEFAULT 120 CHECK (timeout_min BETWEEN 10 AND 1440),
  ociosidade_min   INTEGER NOT NULL DEFAULT 30  CHECK (ociosidade_min BETWEEN 5 AND 1440)
);
```

Mudanças nas tabelas do F2 que vêm deste módulo:

- `execucao.modo` aceita `consulta`;
- `execucao.pgid_pi` guarda o grupo de processos do pi;
- `ticket.instrucao` guarda a resposta do Auditor até ser consumida (6.4).

| Variável de ambiente | Padrão | |
|---|---|---|
| `FABRIQUINHA_ROOT` | `~/fabriquinha` | raiz (F2) |
| `FABRIQUINHA_PORTA` | `4317` | porta do web e trava de instância única |
| `FABRIQUINHA_PI` | `pi` | binário do pi |
| `SONAR_HOST_URL`, `SONAR_TOKEN` | — | coletor do SonarQube (F3) |

## 11. Interface do módulo

| Função | Usada por |
|---|---|
| `iniciarServico(raiz)` | `fabriquinha servidor` |
| `sessoes(filtro)` → lista com estado e motivo (5.2) | F7, lista e histórico |
| `abrirChat(sessao)` → conversa até agora + fluxo de eventos | F7, chat |
| `exportarHistorico(sessao)` → Markdown / `anexarHistorico(sessaoDestino, sessoesOrigem)` | F7, chat (6.8) |
| `conversarSobre(ticket)` → nova consulta (6.5) | F7, chat |
| `enviar(sessao, texto, modo)` | F7, chat (`prompt`, `steer`, `follow_up`, conforme 5.4) |
| `responderDialogo(execucao, id, resposta)` / `abortar(execucao)` | F7, chat |
| `registrarNecessidade(projeto, deps, descricao)` / `concluirSessao(ticket)` | F7 |
| `decidirGate(issue, etapa, decisao)` (6.6) | F7, gates do registro e do desenho na página da issue |
| `iniciarDesenho(ticket)` (6.6) | agendador e Executar agora |
| `decidirProposta(proposta, aceita)` → `{ issue? }` (6.6) | F7, chat do registro e gate do desenho |
| `executarAgora(ticket)` | F7, botão Executar agora |
| `salvarConfiguracao(config)` / `conferirModelo(modelo)` | F7, configuração |

## 12. Verificação

- O pi é substituído por um falso que fala o protocolo RPC, via `FABRIQUINHA_PI`.
  Variantes: termina bem, emite `stopReason: "error"`, abre um diálogo e espera, dorme além do limite, cria um processo filho e some.
  Cada variante tem o seu teste de ponta a ponta contra um banco real.
- Teste do framing: um evento com `U+2028` dentro de uma string chega inteiro.
- Teste de reinício: execuções `em_andamento` gravadas por uma "instância anterior" são encerradas na subida, conforme a seção 7.
- Teste de ociosidade: depois de `ociosidadeMin`, o processo para, e a próxima mensagem retoma a mesma sessão.
- Teste da ordem: duas issues com tickets elegíveis; o da issue mais antiga sai primeiro.

## 13. Fora de escopo

- Controle de uso de contexto (o item 2 do Feedback.txt, limitar a 40%): o diagrama não pede; a compactação do pi segue valendo.
- Limite de execuções autônomas simultâneas.
- Acesso ao web por outra máquina: o serviço escuta só em `127.0.0.1`.

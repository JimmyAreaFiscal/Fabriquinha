# F8 — Simulação

Sistema: Fabriquinha.
Depende de: F1 (erros do domínio), F2 (banco e armazenamento por conteúdo), F4 (`lancarPi`, reinício), F7 (Configuração e rotas da API) e P1 (extensão `navegador`).
Usado por: F7 (Configuração do projeto).

## 1. Responsabilidade

IAs imitam usuários específicos do produto de um projeto para achar problemas de usabilidade e bugs (issue I-10).
Esta spec cobre os **Usuários Simulados** e os seus anexos (2), as **Tarefas** com a alocação (3), as **execuções** e o **relatório** (5); o link do produto fica no Projeto (F1, F7 4.4).

## 2. Usuário Simulado

Cada Usuário Simulado pertence a um projeto e nasce da descrição do usuário e do seu conhecimento.

| Campo | Regra |
|---|---|
| `nome` | Aparado; 1 a 80 caracteres ("Nome obrigatório"). Único dentro do projeto. |
| `descricao` | Aparada; 1 a 4.000 caracteres ("Descrição obrigatória"). |

Não há edição nem remoção do usuário: os critérios de aceite só pedem criar.

### 2.1 Anexos

Manuais e outros arquivos que vão para a IA.

- Só PDF, texto e imagem: `.pdf .txt .md .csv .png .jpg .jpeg .webp .gif`, em qualquer caixa.
  Outro formato é recusado com "formato não suportado: envie PDF, texto ou imagem".
- O nome tem de 1 a 200 caracteres, sem `/` nem caractere de controle: ele vira nome de arquivo na pasta da execução.
- O conteúdo tem até 20 MiB, chega como corpo binário (F7 4.2) e fica em `arquivos/` pelo SHA-256, como as evidências (F2 5.1); anexar o mesmo conteúdo duas vezes ocupa espaço uma vez.
- Anexar com o nome de um anexo existente troca o anexo.
- Remover o anexo apaga a linha; o arquivo em `arquivos/` fica, porque outro anexo ou evidência pode usá-lo.
  ponytail: sem coleta de lixo dos arquivos sem referência, como nas evidências (F2 5.2).

## 3. Tarefa

O que o Usuário Simulado deve tentar fazer no produto, e quantas vezes cada usuário alocado o faz.
O Auditor cria a Tarefa na página Simulação (F7 4.4); não há edição nem remoção: os critérios de aceite só pedem criar.

| Campo | Regra |
|---|---|
| `texto` | Aparado; 1 a 2.000 caracteres ("Tarefa obrigatória"). Texto livre. |
| `n` | Inteiro de 1 a 20 ("N deve ser um inteiro maior que zero"; acima de 20, "N passa de 20"). Execuções por usuário alocado. |
| `usuarios` | Lista de IDs de Usuário Simulado, ao menos um ("Aloque ao menos um usuário simulado"). Todos têm de ser do projeto da Tarefa; repetidos contam uma vez. |

A Tarefa executa pelo Executar (5); `execucoes` traz as execuções dela.

## 4. Persistência

Tabelas `usuario_simulado`, `usuario_simulado_anexo`, `tarefa`, `tarefa_usuario` e `execucao_simulada` (F2 4).
Funções em `src/persistencia/simulacao.ts`:

| Função | O que faz |
|---|---|
| `criarUsuarioSimulado(banco, projeto, entrada)` | Valida `NovoUsuarioSimulado` (domínio, sem I/O); projeto inexistente é `ErroDeInexistente`; nome repetido no projeto é `ErroDeRegra`. |
| `usuariosSimulados(banco, projeto)` | Os usuários do projeto na ordem de criação, cada um com os anexos em ordem de nome. |
| `anexar(banco, usuario, nome, conteudo)` | Valida o nome (`NomeDoAnexo`), guarda o conteúdo (`guardarBytes`) e grava ou troca o anexo. |
| `removerAnexo(banco, usuario, nome)` | Apaga o anexo; anexo ou usuário inexistente é `ErroDeInexistente`. |
| `criarTarefa(banco, projeto, entrada)` | Valida `NovaTarefa` (domínio, sem I/O); projeto inexistente é `ErroDeInexistente`; usuário que não é do projeto é `ErroDeRegra`, sem gravar nada. Grava a Tarefa e a alocação na mesma transação. |
| `tarefas(banco, projeto)` | As Tarefas do projeto na ordem de criação, cada uma com os usuários alocados (`id`, `nome`, em ordem de criação do usuário) e as `execucoes` (5.4). |
| `enfileirar(banco, tarefa)` | Sem link do produto, `ErroDeRegra(SEM_LINK)`; com execução pendente, `ErroDeRegra` "a Tarefa já está em execução"; Tarefa inexistente, `ErroDeInexistente`. Senão grava, numa transação, N × k linhas `na_fila` (k = usuários alocados; usuário por usuário, N seguidas de cada um) e devolve os IDs, na ordem, e o link. |
| `marcar(banco, id, marca)` | `em_andamento` (grava `iniciada_em`), `concluida` (com o `relatorio`) ou `falhou` (com o `erro`); as duas últimas gravam `terminada_em` e soltam o `pgid`. |
| `gravarPgid(banco, id, pgid)` | O grupo de processos do pi da execução. |
| `falharPendentes(banco, erro)` | Reinício (5.5): marca `falhou` toda execução `na_fila` ou `em_andamento` e devolve os `pgid` dos pi vivos. |
| `paraRodar(banco, id)` | O texto da Tarefa e o Usuário Simulado, com os anexos, da execução. |

Remover o projeto apaga os usuários, os anexos, as Tarefas, as alocações e as execuções dele, e as pastas das execuções (F2 4); com execução pendente, recusa.

## 5. Execução e relatório

O Auditor dispara a Simulação pelo **Executar** de uma Tarefa (`POST /api/tarefas/:id/executar`, F7 4.2); não há agendador. O código está em `src/simulacao/executor.ts`.

### 5.1 Executar

`executarTarefa(banco, tarefa, { timeoutMin })` enfileira **de forma síncrona** (`enfileirar`, 4): sem link do produto lança `ErroDeRegra` com a mensagem `SEM_LINK` ("Informe o link do produto na Configuração do projeto"), com execução pendente da Tarefa lança "a Tarefa já está em execução", e nada é gravado. Senão devolve uma promessa que resolve quando a última execução termina; ela só rejeita se o banco falhar. A rota a deixa em segundo plano (erro vai para o log) e responde 204.

As execuções da Tarefa rodam **uma por vez**, na ordem da fila. A falha de uma (qualquer erro) vira o `falhou` dela, com a mensagem, e a seguinte roda. Duas Tarefas executadas juntas rodam em paralelo.
ponytail: a fila é por Tarefa; uma fila global se o Chromium de duas Tarefas ao mesmo tempo pesar.

### 5.2 Uma execução

1. `em_andamento`.
2. `conferirLink`: um `HEAD` no link, com limite de 15 s. Qualquer resposta HTTP, até 500, conta como no ar (a página quebrada é achado do relatório); erro de rede ou o limite estourado termina a execução em `falhou` com `LINK_FORA_DO_AR` ("Não foi possível abrir o link do produto"), sem subir o pi.
3. A pasta `<raiz>/simulacoes/<id>/` (F2 2) recebe os anexos do usuário por hard link, com o nome original; o conteúdo continua só em `arquivos/`. Cada PDF vira também `<nome>.txt` pelo `pdftotext`, gravado sem sobrescrever (`wx`: o `.txt` nunca grava por cima de um anexo). Sem `pdftotext` instalado ou com PDF que ele não lê, a execução falha com a mensagem.
4. O pi sobe em `--mode json` por `lancarPi` (F4 6.1), com `cwd` na pasta, `--session-dir <pasta>/sessao`, `--tools ver_tela,clicar,digitar,tecla,rolar,relatar` (só as da extensão), `-e pacote-pi/extensions/navegador.ts`, os anexos como `@arquivo` (o `.txt` no lugar do PDF: o pi lê texto, não PDF) e o prompt da persona como última mensagem. O modelo é o padrão do pi.
5. Ambiente: o do serviço sem credenciais (`ambienteSemCredenciais`, F4 6.1.2) mais `FABRIQUINHA_LINK` (o link do momento do Executar) e `FABRIQUINHA_SAIDA` (`<pasta>/saida`). O `pgid` do pi é gravado; o stderr vai para `<pasta>/log`.
6. Passado `timeoutMin` (o mesmo do F4 3), o pi é parado (`parar()`: SIGTERM, 10 s, SIGKILL no grupo) e a execução termina `falhou` com "passou do limite de N min e foi encerrado".
7. Ao fim do pi, `<pasta>/saida/relatorio.json` válido (`RelatorioSimulacao`) leva a `concluida` com o relatório; arquivo ausente ou inválido leva a `falhou` com "o agente não entregou o relatório". Sem o binário do pi ou sem Chromium acontece o mesmo, e o motivo está no `log` da execução.

### 5.3 O prompt da persona

Diz quem é o Usuário Simulado (nome, descrição), o link do produto e a Tarefa; que ele usa o produto só pela tela, com a familiaridade da descrição; que cumpre **só a Tarefa**, sem ações irreversíveis (apagar, pagar, enviar de verdade) e sem sair do produto; e que termina sempre chamando `relatar` uma vez, com as listas vazias se nada atrapalhou. Com anexos, avisa que são os manuais dele. A ajuda do campo Link do produto, na Configuração, recomenda um ambiente de homologação.

### 5.4 O relatório

`RelatorioSimulacao` (domínio, sem I/O): `{ usabilidade: string[], bugs: string[] }`, cada seção com até 50 achados de 1 a 2.000 caracteres. É o que a ferramenta `relatar` (P1) grava em `relatorio.json`. Não há vídeo, print nem trilha das ações.

`tarefas()` traz cada execução como `{ id, usuario, usuarioNome, status, relatorio?, erro? }`, na ordem da fila; `status` é `na_fila`, `em_andamento`, `concluida` ou `falhou` (`StatusExecucaoSimulada`). Executar de novo acrescenta execuções às anteriores.

### 5.5 Reinício

No `recuperar()` do serviço (F4 7), `falharPendentes(banco, "serviço reiniciado")` marca como `falhou` toda execução simulada pendente e o serviço mata (SIGKILL) o grupo de cada `pgid` devolvido. As terminadas ficam como estão.

## 6. Interface

Rotas em F7 4.2 (Simulação), a seção "Usuários simulados" da Configuração e a página Simulação em F7 4.4.

## 7. Verificação

- Domínio: mensagens exatas dos campos e o formato do anexo, com os limites de tamanho.
- Persistência contra SQLite real: criar, listar, repetido, projeto inexistente, anexar, trocar, remover, constraints das tabelas e remoção do projeto com usuário e anexo.
- Servidor e rotas: corpo binário aceito até 20 MiB, 422 acima, JSON inalterado em 64 KiB; status e mensagens de cada rota.
- Domínio: as mensagens exatas de `NovaTarefa` e os limites de N (0, 1, 20, 21, fracionário, não numérico).
- Persistência: criar com alocação, repetidos, usuário de outro projeto, projeto inexistente, listar só as do projeto e constraints de `tarefa` e `tarefa_usuario`.
- Ponta a ponta (Playwright): criar o usuário, o erro de descrição, anexar com o tamanho em bytes e remover; criar a Tarefa com N e usuário alocado, e os erros de N e de alocação.
- Domínio: `RelatorioSimulacao` (vazio, 50 achados de 2.000, 51, 2.001, achado vazio, seção faltando) e as mensagens `SEM_LINK` e `LINK_FORA_DO_AR`.
- Persistência: `enfileirar` (N × k na ordem, sem link, pendente, inexistente, executar de novo), `marcar`, `gravarPgid`, `falharPendentes`, `paraRodar`, constraints de `execucao_simulada` e remoção do projeto com execução simulada (pendente recusa; terminadas e pastas apagadas).
- Executor com pi falso (`$FABRIQUINHA_PI`) e servidor HTTP local: uma por vez, concluída (CA-11, CA-12), argumentos e ambiente do pi, anexo por hard link, PDF por `pdftotext`, PDF ilegível, sem relatório (ausente e inválido), timeout, link fora do ar (CA-14), link do momento do Executar e pi inexistente.
- Serviço: o reinício falha as pendentes e mata o `pgid`. Rota: 204, 409 sem link (CA-10) e com pendente, 404 e 422.
- Cliente (render puro): botão Executar e "Executando…", tabela das execuções, alerta do 409 no cartão e relatório com "Nenhum achado" (CA-13).
- Ponta a ponta (Playwright, pi falso): CA-10 a CA-14.

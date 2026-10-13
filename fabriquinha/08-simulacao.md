# F8 — Simulação

Sistema: Fabriquinha.
Depende de: F1 (erros do domínio), F2 (banco e armazenamento por conteúdo), F7 (Configuração e rotas da API).
Usado por: F7 (Configuração do projeto).

## 1. Responsabilidade

IAs imitam usuários específicos do produto de um projeto para achar problemas de usabilidade e bugs (issue I-10).
Esta spec cobre, por enquanto, os **Usuários Simulados** e os seus anexos (2); o link do produto fica no Projeto (F1, F7 4.4).
As Tarefas, as execuções e o relatório entram nos tickets seguintes da I-10, nesta mesma spec.

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

## 3. Persistência

Tabelas `usuario_simulado` e `usuario_simulado_anexo` (F2 4).
Funções em `src/persistencia/simulacao.ts`:

| Função | O que faz |
|---|---|
| `criarUsuarioSimulado(banco, projeto, entrada)` | Valida `NovoUsuarioSimulado` (domínio, sem I/O); projeto inexistente é `ErroDeInexistente`; nome repetido no projeto é `ErroDeRegra`. |
| `usuariosSimulados(banco, projeto)` | Os usuários do projeto na ordem de criação, cada um com os anexos em ordem de nome. |
| `anexar(banco, usuario, nome, conteudo)` | Valida o nome (`NomeDoAnexo`), guarda o conteúdo (`guardarBytes`) e grava ou troca o anexo. |
| `removerAnexo(banco, usuario, nome)` | Apaga o anexo; anexo ou usuário inexistente é `ErroDeInexistente`. |

Remover o projeto apaga os usuários e os anexos dele (F2 4).

## 4. Interface

Rotas em F7 4.2 (Simulação) e a seção "Usuários simulados" da Configuração em F7 4.4.

## 5. Verificação

- Domínio: mensagens exatas dos campos e o formato do anexo, com os limites de tamanho.
- Persistência contra SQLite real: criar, listar, repetido, projeto inexistente, anexar, trocar, remover, constraints das tabelas e remoção do projeto com usuário e anexo.
- Servidor e rotas: corpo binário aceito até 20 MiB, 422 acima, JSON inalterado em 64 KiB; status e mensagens de cada rota.
- Ponta a ponta (Playwright): criar o usuário, o erro de descrição, anexar com o tamanho em bytes e remover.

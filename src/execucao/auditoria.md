## Modo de trabalhar: auditoria do Histórico

**Objetivo:** auditar as sessões terminadas do mês acima, de todos os projetos, e propor melhorias ao Auditor.

**O que você recebe:** a pasta da auditoria é o seu diretório de trabalho.

- `indice.md`: a tabela das sessões do mês, os custos do mês (por modelo e por etapa) e, na seção **Qualidade**, o retrabalho e as correções do Auditor das issues com sessão no mês.
- `sessoes/`: uma conversa em Markdown por sessão, com o nome que o índice indica na coluna Arquivo.

**Passos:**

1. Leia o `indice.md`.
2. Chame **uma vez** a ferramenta `subagent`, em modo paralelo (`tasks`), com três tarefas do agente `scout`. Cada tarefa diz o que analisar e o contexto de que precisa: o caminho completo do `indice.md` e da pasta `sessoes/`, o mês e o que olhar no índice. Nenhum subagente vê esta conversa.
   - **Oportunidades de melhoria:** leia as conversas e ache o que se repete e atrasa o trabalho: instruções que o agente não entendeu, retrabalho, erros de ferramenta, perguntas que o prompt devia ter respondido, passos que podiam ser automáticos.
   - **Custos:** leia a seção Custos do índice e as sessões mais caras; diga onde está o gasto (modelo, etapa, projeto, sessão) e o que o reduziria.
   - **Qualidade:** leia a seção Qualidade do índice e as sessões das issues com mais retrabalho ou correções; diga onde o trabalho saiu errado e por quê.
3. Responda ao Auditor com as seções abaixo, nesta ordem, cada uma com o resultado do seu subagente:
   - `## Oportunidades de melhoria`
   - `## Custos`
   - `## Qualidade`: cite a quantidade de retrabalho (linhas alteradas depois e por pessoas) e de correções do Auditor (registro e desenho) da seção Qualidade do índice, com o total do mês e as issues que mais pesam.
   - `## Melhorias propostas`: a lista das melhorias, da que mais compensa para a que menos, cada uma com o problema que resolve e a evidência (a sessão ou o número do índice).

**Depois da resposta:** o Auditor pode perguntar sobre as melhorias. Responda na mesma conversa, com os mesmos arquivos; abra a sessão que a pergunta pede em vez de lembrar de memória.

**Se a ferramenta `subagent` não existir:** diga isso na resposta e faça as três análises, uma depois da outra, você mesmo, com as mesmas seções.

**O que não fazer:** só proponha. Não registre issue nem ticket, não altere arquivo nem projeto, não crie PR, não faça commit nem push e não use outro agente além do `scout`. As melhorias ficam como texto na sua resposta; quem as registra é o Auditor.

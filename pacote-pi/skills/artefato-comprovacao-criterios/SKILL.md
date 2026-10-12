---
name: artefato-comprovacao-criterios
description: Use ao produzir a evidência `comprovacao_criterios` da Fabriquinha.
---

# Comprovação dos critérios

## Para que serve

O Auditor lê a comprovação para decidir se a issue vai para o PR: a revisão só aprova com todos os critérios atendidos.
Um critério não atendido vira ticket de desenvolvimento, e o desenvolvedor parte do seu `comoVerificado` para corrigir.
Quem revisa o PR lê o `comoVerificado` de cada critério na seção Evidências, muitas vezes sem acesso aos vídeos e prints.

A comprovação é um **experimento**: você executa cada critério no produto como um usuário e registra o que viu, seja qual for o resultado.

## Como produzir

1. Leia cada `CA-n`: o `dado` é o estado de partida, o `quando` é a ação, o `entao` é o resultado esperado.
2. Rode o projeto na worktree, com o código da issue.
3. Para cada critério, na ordem dos ids:
   1. Monte o estado do `dado` com dados realistas.
   2. Faça a ação do `quando` como o usuário faria: na tela, no comando, na chamada.
   3. Compare o que apareceu com o `entao`, palavra por palavra quando o critério cita um texto.
   4. Grave a prova em `$FABRIQUINHA_SAIDA`:
      - interação (clique, digitação, transição): um vídeo curto, do estado do `dado` ao resultado;
      - resultado estático (tela, saída de terminal): um print com o resultado visível por inteiro.
4. Marque `atendido` só quando o resultado observado é o do `entao`; diferença parcial é "não atendido".
5. Dê a cada arquivo um nome que diga o critério (`ca-3-erro-sem-motivo.png`) e cite esse nome nos critérios que ele prova.

Teste automatizado passando é contexto, e a prova é o produto rodando.
Quando o critério não pode ser executado (serviço externo fora do ar, dado impossível de montar), ele é "não atendido", e o `comoVerificado` diz o que impediu.

## Estrutura

`criterios`: um item por critério de aceite do registro, com o mesmo `id`.

`atendido`: o resultado do experimento, `true` ou `false`.

`comoVerificado`, sozinho suficiente para quem não vê o anexo:

- o estado montado e a ação feita, com os valores usados;
- o que apareceu, citando texto, valor ou código de saída;
- num não atendido, a diferença para o `entao`: "esperado: a issue passa para desenho; observado: erro 500 e a issue continua no registro".

`arquivos`: os nomes dos anexos que provam o critério, só o nome do arquivo, sem diretório; um anexo pode provar mais de um critério.

## Antes de submeter

- [ ] Cada critério do registro aparece uma vez, e cada um foi executado nesta execução.
- [ ] Todo `atendido: true` tem anexo que mostra o resultado do `entao`.
- [ ] Todo não atendido diz o esperado e o observado, para o desenvolvedor reproduzir.
- [ ] Cada nome em `arquivos` é o nome de um arquivo anexado nesta submissão.
- [ ] Os anexos estão em `$FABRIQUINHA_SAIDA` e mostram dados de teste, sem credencial nem dado pessoal.

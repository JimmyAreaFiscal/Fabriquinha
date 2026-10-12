---
name: artefato-video-explicativo
description: Use ao produzir a evidência `video_explicativo` da Fabriquinha.
---

# Vídeo explicativo

## Para que serve

Quem revisa o PR assiste ao vídeo antes de ler o código: em poucos minutos entende o problema, vê a solução funcionando e sabe onde olhar no diff.
O Auditor o vê junto com as evidências da issue ao aprovar o PR.

O vídeo é uma **demonstração guiada**: segue um roteiro escrito antes e mostra só o que ajuda a revisar.

## Como produzir

1. Escreva o roteiro, em três partes, nesta ordem:
   1. O problema: o comportamento antes da mudança ou a lacuna, em uma ou duas frases, com a tela ou a saída onde ele aparecia.
   2. A solução funcionando: o caminho feliz de ponta a ponta e um caminho de erro dos critérios de aceite, com dados realistas.
   3. O que olhar no código: os dois ou três arquivos centrais, na mesma ordem do `comoRevisar` da mensagem do PR, e o que cada um faz.
2. Rode o projeto na worktree, com o código da issue, e prepare os dados antes de gravar.
3. Grave um único vídeo em `$FABRIQUINHA_SAIDA`, seguindo o roteiro, com até 3 minutos.
4. Assista ao vídeo inteiro e regrave o que ficou ilegível, cortado ou fora do roteiro.

## Estrutura

O vídeo:

- abre na tela ou no terminal onde o problema aparece, já com os dados preparados;
- para alguns segundos em cada resultado, com o texto legível;
- mostra o código no editor, com a fonte em tamanho de leitura, rolando até o trecho que importa.

Fica fora do vídeo, para ele caber no tempo e poder ser compartilhado:

- credencial, token, variável de ambiente, dado pessoal ou de cliente;
- espera de build, instalação ou teste lento;
- o diff inteiro, linha por linha;
- abas, janelas e notificações que não fazem parte da issue.

`roteiro`: as três partes, na ordem do vídeo, uma frase por cena, com o que aparece na tela e o que ela prova.
Quem lê só o roteiro sabe o que o vídeo mostra.

## Antes de submeter

- [ ] Há um só vídeo, em `$FABRIQUINHA_SAIDA`, com até 3 minutos.
- [ ] O resultado que o vídeo mostra é o do código da issue rodando.
- [ ] As três partes do roteiro aparecem no vídeo, na mesma ordem.
- [ ] Nenhum quadro mostra credencial nem dado pessoal.
- [ ] O texto na tela é legível sem ampliar.

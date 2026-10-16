---
name: artefato-video-demonstracao
description: Use ao produzir a evidência `video_demonstracao` da Fabriquinha, só quando a mudança aparece no cliente (frontend).
---

# Vídeo de demonstração

## Para que serve

O Auditor assiste ao vídeo para ver o sistema funcionando antes de aprovar o PR, do jeito que o usuário final o vê.
A lógica do código fica na aula do código; o vídeo mostra só o resultado, pelo cliente.

O vídeo existe **só quando a mudança aparece no cliente** (tela, página, formulário, componente visual).
Mudança sem efeito visível no cliente (CLI, serviço, biblioteca, banco, configuração) não tem vídeo: não submeta esta evidência.

## Como produzir

1. Decida se a mudança aparece no cliente; se não aparece, pare aqui.
2. Escreva o roteiro: o caminho feliz de ponta a ponta e um caminho de erro dos critérios de aceite, com dados realistas.
3. Rode o projeto na worktree, com o código da issue, e prepare os dados antes de gravar.
4. Grave um único vídeo em `$FABRIQUINHA_SAIDA`, só da janela do cliente, seguindo o roteiro, com até 2 minutos.
5. Assista ao vídeo inteiro e regrave o que ficou ilegível, cortado ou fora do roteiro.

## Estrutura

O vídeo:

- mostra só o cliente: nada de editor, terminal ou código;
- abre na tela onde a mudança aparece, já com os dados preparados;
- para alguns segundos em cada resultado, com o texto legível.

Fica fora do vídeo, para ele caber no tempo e poder ser compartilhado:

- credencial, token, variável de ambiente, dado pessoal ou de cliente;
- espera de build, instalação ou carregamento lento;
- abas, janelas e notificações que não fazem parte da issue.

`roteiro`: uma frase por cena, na ordem do vídeo, com o que aparece na tela e o critério de aceite que ela mostra.
Quem lê só o roteiro sabe o que o vídeo mostra.

## Antes de submeter

- [ ] A mudança aparece no cliente; sem isso, não há vídeo.
- [ ] Há um só vídeo, em `$FABRIQUINHA_SAIDA`, com até 2 minutos.
- [ ] O vídeo mostra só o cliente, rodando o código da issue.
- [ ] Cada cena do roteiro aparece no vídeo, na mesma ordem.
- [ ] Nenhum quadro mostra credencial nem dado pessoal.
- [ ] O texto na tela é legível sem ampliar.

---
name: artefato-prototipo
description: Use ao produzir a evidência `prototipo` da Fabriquinha.
---

# Protótipo

## Para que serve

O Auditor vê o protótipo para aprovar o desenho de uma funcionalidade: ele confere, antes de alguém construir, que o resultado visível é o que ele pediu.
O agente da revisão compara o que foi entregue com o protótipo aprovado.

O protótipo é uma **prévia**: mostra a solução como o usuário vai vê-la, com o mínimo de código que a faz aparecer.

## Como produzir

1. Escolha, nos critérios de aceite, o que o usuário vê ou faz: telas, mensagens, saídas de comando, o caminho feliz e o de erro.
2. Faça a solução aparecer do jeito mais barato: dados fixos, atalhos e código provisório na worktree, ou um HTML à parte quando a mudança for só de tela.
   Toda alteração na worktree é descartada ao fim desta execução; o código definitivo fica para os tickets de desenvolvimento.
3. Rode o projeto e grave em `$FABRIQUINHA_SAIDA`:
   - interação (clique, digitação, transição): um vídeo curto, do estado inicial ao resultado de cada critério visível;
   - estado estático: um print por tela ou estado, mostrando o que muda.
4. Escreva a `descricao`, e `comoExecutar` quando alguém puder repetir o protótipo; confira o formato com o schema do tipo antes de submeter.

## Estrutura

Arquivos, todos em `$FABRIQUINHA_SAIDA`:

- Pelo menos um vídeo ou um print; é a prova que o Auditor vê primeiro.
- O vídeo segue a ordem dos critérios de aceite e para alguns segundos em cada resultado.
- O print mostra a tela inteira em que a mudança aparece, com dados realistas.
- Um HTML de protótipo é **autocontido**: um arquivo só, começando por `<!doctype html>`, com CSS em `<style>`, SVG no próprio documento e imagens como `data:` URI, nada vindo de fora do arquivo.
- Um arquivo de texto entra quando o resultado visível é uma saída de terminal.

`descricao`:

- O que o protótipo mostra, na ordem do vídeo ou dos prints, citando os `CA-n` que cada trecho cobre.
- O que é provisório (dado fixo, tela incompleta) e o que fica igual na versão final.

`comoExecutar`: os passos para ver o protótipo, prontos para copiar, quando ele roda fora da worktree descartada (um HTML à parte, por exemplo).

## Antes de submeter

- [ ] Há pelo menos um vídeo ou print, e ele mostra a solução, não o comportamento atual.
- [ ] Cada critério de aceite com resultado visível aparece no vídeo ou num print.
- [ ] A `descricao` diz o que é provisório, para o Auditor julgar a solução e não o atalho.
- [ ] Os arquivos estão em `$FABRIQUINHA_SAIDA`, fora do repositório.
- [ ] Um HTML anexado abre sozinho, sem rede.

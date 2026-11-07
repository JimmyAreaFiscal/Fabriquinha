---
name: artefato-comportamento
description: Use ao produzir a evidência `comportamento` da Fabriquinha.
---

# Comportamento

## Para que serve

O Auditor lê o comportamento na página da demanda para aprová-la: ele confere que o problema ou a lacuna é real e é o que foi relatado.

O artefato é uma **prova**: alguém que nunca viu a conversa segue os passos e vê o mesmo resultado.

## Como produzir

1. Descubra no repositório onde o comportamento acontece: a tela, o comando, o endpoint ou a função.
2. Reproduza o comportamento atual de verdade, rodando o projeto ou o trecho de código.
   Numa funcionalidade nova, reproduza o que acontece hoje no lugar onde ela vai entrar.
3. Anote cada ação que você fez, na ordem, com os valores exatos que usou.
4. Grave a prova na pasta onde você roda o `fabriquinha`, que é a única origem aceita para os anexos:
   - comportamento visível (tela, saída de terminal): um vídeo curto do primeiro passo até o resultado;
   - comportamento no código: um arquivo de texto com o trecho que o causa, com o caminho e as linhas de origem, e a saída que ele produz (log, erro, resultado de teste).
5. Escreva a `descricao` e os passos em `comoReproduzir`, e confira o formato com o schema do tipo antes de submeter.

## Estrutura

`descricao`:

- Uma frase com o comportamento atual, como um fato observado: "Ao salvar um projeto sem branch base, a tela mostra erro 500."
- Numa demanda de problema, o que se esperava no lugar; numa funcionalidade, o que falta hoje.
- Onde acontece: tela, comando ou arquivo e função.
- Condições que mudam o resultado: dados, configuração, frequência ("sempre", "só com dois projetos").

`comoReproduzir`, um passo por item:

- Uma ação por passo, no imperativo: "Abra", "Rode", "Clique em".
- Comandos completos e valores concretos, prontos para copiar.
- O último passo diz o resultado observado: "Veja a mensagem X na tela."

Arquivos:

- O vídeo mostra exatamente os passos de `comoReproduzir`, na mesma ordem.
- O arquivo de texto traz o trecho de código e a saída que provam o comportamento, cada um com a origem.

## Antes de submeter

- [ ] Eu mesmo reproduzi o comportamento nesta execução; os passos são os que segui.
- [ ] Quem não participou da conversa reproduz com os passos, sem pedir nada.
- [ ] A `descricao` diz o que acontece hoje; a solução fica para o desenho.
- [ ] Os passos começam de um estado conhecido (projeto aberto, dado criado) e terminam no resultado observado.
- [ ] A prova anexada mostra o mesmo comportamento que a `descricao` afirma.

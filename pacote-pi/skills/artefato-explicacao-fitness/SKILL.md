---
name: artefato-explicacao-fitness
description: Use ao produzir a evidência `explicacao_fitness` da Fabriquinha.
---

# Explicação das fitness functions

## Para que serve

A revisão da rodada só aprova com todas as linhas da matriz passando: a Fabriquinha recusa o `aprovar` antes disso.
O Auditor lê as explicações na página da demanda antes de aprovar o PR da rodada, sem ter visto o log.

Cada explicação é uma **leitura do log**: diz o que a fitness mediu nesta rodada e o que o resultado prova, com o que está escrito no log.

## Como produzir

1. Leia a evidência `matriz_fitness` que a Fabriquinha gravou neste ticket, rodada na worktree da rodada, com o `log` de cada linha.
2. Para cada linha, entenda pelo `comando`, pela `descricao` e pelo código da fitness o que ela confere.
3. Leia o log até achar o que decide o resultado:
   - passou: o que foi conferido e em quantos itens (arquivos, módulos, regras);
   - falhou: a primeira violação, com o arquivo e a regra, e se o arquivo está entre os alterados da rodada;
   - estourou o tempo ou terminou sem código de saída: onde o log parou.
4. Ligue o resultado à rodada: que parte da mudança a fitness cobriu, ou por que ela não toca a mudança.
5. Escreva uma explicação por linha da matriz, com o `nome` exato da linha; se os nomes não baterem, o erro da submissão lista as linhas da matriz.

## Estrutura

`explicacoes`: um item por linha da matriz, na ordem da matriz.

`nome`: o `nome` da linha, copiado da matriz.

`explicacao`, em até três frases curtas, nesta ordem:

1. O que a fitness mede, em termos do produto ou da arquitetura: "Confere que nenhum módulo de domínio importa a camada web."
2. O que o log mostra: "Passou em 42 arquivos, 3 deles alterados nesta rodada." ou "Falhou: `src/dominio/x.ts` importa `src/web/y.ts`."
3. O que isso significa para a rodada: "A nova regra de cobrança ficou no domínio, sem depender da tela." ou "A falha vem do arquivo novo desta rodada e impede a aprovação da revisão."

O resultado (passou, falhou, código de saída, duração) já está na matriz; a explicação acrescenta o porquê.

## Antes de submeter

- [ ] Há exatamente uma explicação por linha da matriz, com os mesmos nomes.
- [ ] Cada explicação cita algo que está no log: número, arquivo, regra ou mensagem.
- [ ] Uma falha aparece como falha, com a causa e se ela vem da mudança desta rodada.
- [ ] Quem não abriu o log entende o que foi provado e o que não foi.

---
name: artefato-aula-codigo
description: Use ao produzir a evidência `aula_codigo` da Fabriquinha.
---

# Aula do código

## Para que serve

O Auditor estuda a aula antes de aprovar o PR: ela ensina a lógica por trás de cada parte do código alterado, na ordem em que vale a pena ler.
Quem termina a aula entende por que o código é como é, sem ter acompanhado o desenvolvimento.

Você escreve só a explicação.
A Fabriquinha confere que cada trecho é código alterado pela rodada, lê as linhas do git e gera o HTML com o código ao lado da explicação.

## Como produzir

1. Leia o plano, a descrição da demanda e o diff da branch da rodada contra a branch da demanda (`fabriquinha/I-<n>`): é o diff que a última revisão da rodada gravou em `arquivos_alterados`.
2. Escolha os trechos que contam a mudança: o ponto de entrada, a regra central, os casos de erro e o que liga as partes.
   Deixe de fora o que se entende sozinho (import, renomeação, ajuste de teste óbvio).
3. Ordene os trechos como uma aula: do ponto de entrada até o detalhe, cada um apoiado no anterior.
4. Para cada trecho, confira as linhas no arquivo atual: o trecho precisa tocar pelo menos uma linha alterada pela rodada e ter até 60 linhas.
5. Escreva a explicação de cada trecho e submeta só com `--dados`; o erro da Fabriquinha diz o que corrigir.

## Estrutura

`trechos`, na ordem de leitura; cada um tem:

- `arquivo`: o caminho como aparece no `arquivos_alterados`;
- `inicio` e `fim`: as linhas do trecho no arquivo atual, inclusive;
- `oQueFaz`: o que o trecho faz, em uma ou duas frases;
- `porQue`: a lógica por trás dele, o centro da aula: por que este caminho, que caso ele trata, o que quebraria sem ele;
- `decisaoDoDesenho`: a decisão que o trecho cumpre, com as palavras de onde ela foi tomada: a descrição da demanda, o plano ou o ticket;
- `alternativaDescartada`: opcional; outra forma que existia e por que não foi a escolhida.

Escreva para quem conhece o projeto, mas não viu a conversa nem o diff.

- Bom `porQue`: "A validação vem antes do lock porque a maioria das entradas é recusada; assim o lock só é pego quando vai haver escrita."
- Fraco `porQue`: "Valida a entrada e grava no banco."

## Antes de submeter

- [ ] A ordem dos trechos conta a mudança do começo ao fim, sem saltos.
- [ ] Todo arquivo central da mudança tem pelo menos um trecho.
- [ ] Cada `porQue` explica uma razão, e não repete o `oQueFaz`.
- [ ] Cada `decisaoDoDesenho` cita uma decisão que está na descrição da demanda, no plano ou no ticket.
- [ ] Nenhum trecho passa de 60 linhas; um trecho longo vira dois.

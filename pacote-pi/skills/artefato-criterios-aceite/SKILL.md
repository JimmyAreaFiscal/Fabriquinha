---
name: artefato-criterios-aceite
description: Use ao produzir a evidência `criterios_aceite` da Fabriquinha.
---

# Critérios de aceite

## Para que serve

O Auditor lê os critérios para aprovar o registro: eles dizem o que "pronto" significa para esta issue.
Depois, cada etapa trabalha só com eles, sem a conversa do registro: o desenho propõe a solução que os atende, o desenvolvimento os implementa e a revisão verifica cada um e grava a prova.

Um critério é um **contrato verificável**: quem nunca viu a conversa executa o critério e chega a "atendido" ou "não atendido", sem interpretar.

## Como produzir

1. Liste cada resultado que o Auditor espera, a partir da conversa e do comportamento registrado.
2. Para cada resultado, escreva o caminho feliz e pelo menos um caminho de erro: entrada inválida, falta de permissão, recurso ausente, falha externa.
3. Escreva cada critério no formato dado/quando/então, um comportamento observável por critério.
4. Leia cada critério como se fosse o agente da revisão: defina como você provaria com um print ou um vídeo.
   Reescreva o critério que não der para provar assim.
5. Numere `CA-1`, `CA-2`, … na ordem de leitura e confira o formato com o schema do tipo antes de submeter.

## Estrutura

Cada critério tem `id`, `dado`, `quando` e `entao`.
A Fabriquinha monta a frase "dado …, quando …, então …", então escreva cada campo como continuação dela, sem repetir a palavra-chave.

`dado`: o estado de partida, concreto.

- Bom: "um projeto com branch base `main` e nenhuma issue aberta".
- Fraco: "o sistema configurado".

`quando`: uma única ação, de quem age.

- Bom: "o Auditor clica em Aprovar registro sem motivo".
- Fraco: "o usuário usa a tela".

`entao`: o resultado observável e conferível: texto exato na tela, valor gravado, código de saída, arquivo criado.

- Bom: "a issue passa para a etapa desenho e o botão some".
- Fraco: "funciona corretamente", "é rápido", "a experiência melhora".

Um número entra só com unidade e limite: "responde em até 2 s com 1.000 issues".

## Antes de submeter

- [ ] Cada `entao` é verificável por quem não participou da conversa, com print ou vídeo.
- [ ] Cada critério tem um só `quando` e um só resultado; o que tiver "e também" vira dois critérios.
- [ ] Todo resultado esperado tem pelo menos um caminho de erro coberto.
- [ ] Os critérios descrevem o comportamento visto de fora; a solução interna fica para o desenho.
- [ ] Os termos são os do produto e do código (nomes de tela, comando, campo), os mesmos da conversa com o Auditor.
- [ ] O Auditor reconhece nos critérios tudo o que pediu, e só o que pediu.

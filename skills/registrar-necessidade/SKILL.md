---
name: registrar-necessidade
description: Registra na Fabriquinha uma necessidade relatada pelo usuário (problema, bug, incômodo ou funcionalidade) como issue, com o comportamento atual e os critérios de aceite, questionando antes de escrever. Use quando o usuário pedir para registrar, abrir issue ou ticket, ou levar uma necessidade à Fabriquinha.
---

# Registrar necessidade na Fabriquinha

Você é a **IA externa**: registra a necessidade pelo `fabriquinha necessidade`, sem sessão do pi.
O registro vai ao gate do Auditor na página da issue; aprovado, a Fabriquinha segue sozinha para o desenho.

Cada necessidade vira **uma issue**.
Vários problemas no mesmo pedido viram várias issues, uma por problema.

## Passo 1: leia o código antes de perguntar

Antes da primeira pergunta, encontre e leia o que a necessidade toca: o arquivo, a função, a tela, o comando, o teste que deveria pegar isso.
Pergunte só o que o código não decide; o resto você lê.
Quando o código mostrar outra causa para o sintoma relatado, leve esse achado às perguntas.

## Passo 2: pergunte com `AskUserQuestion`

No máximo **duas rodadas** de até 4 perguntas; o que ainda faltar vira assunção escrita na descrição.

Pergunte o que muda o trabalho de verdade: regra de negócio, preferência do usuário, caso de borda que o relato não cobriu (lista vazia, item ausente, concorrência).
Nas opções, descreva a **consequência** de cada escolha, e use `preview` quando as opções forem formatos concretos.
Quando a resposta depende do que só o desenho vai descobrir, ofereça a opção "o desenho decide".

Em incidente ("caiu", "travou"), pergunte primeiro os fatos: quanto durou, como aconteceu, em qual ambiente, se é recorrente.

## Passo 3: reproduza e escreva as evidências

Siga as skills da Fabriquinha para cada evidência, que estão no repositório da Fabriquinha (relativo à pasta real desta skill):

- `comportamento`: `../../pacote-pi/skills/artefato-comportamento/SKILL.md`;
- `criterios_aceite`: `../../pacote-pi/skills/artefato-criterios-aceite/SKILL.md`.

Elas foram escritas para o agente de dentro da Fabriquinha; aqui, três coisas mudam:

- a prova (vídeo, print, texto) fica na pasta onde você roda o `fabriquinha`, nunca fora dela;
- a mudança de mais de 30 arquivos vira issues separadas, registradas por você, com `--dep` para a ordem; o `issue propor` é só do agente de dentro;
- quem confirma o conteúdo é o usuário desta conversa.

Confira o formato de cada evidência com `fabriquinha necessidade schema <tipo>`.

## Passo 4: registre e envie

Mostre ao usuário o título, o tipo, a descrição e os critérios, e só registre depois do "sim" dele.

```bash
fabriquinha necessidade registrar --projeto <p> --titulo "<título>" --tipo <funcionalidade|problema> --descricao desc.md [--dep I-<m>]...
fabriquinha necessidade evidencia I-<n> comportamento --dados comp.json --arquivo <prova>...
fabriquinha necessidade evidencia I-<n> criterios_aceite --dados criterios.json
fabriquinha necessidade enviar I-<n>
```

O título diz o efeito, não a solução: "Listagem de Processos precisa trazer os Objetos junto", e não "Adicionar campo objetos[] no schema".

A descrição (`desc.md`, até 1.000 palavras) traz estas seções, nesta ordem, e omite a que estiver vazia:

- **Problema** — o que está errado ou falta hoje, com os caminhos de arquivo que você leu.
- **Decisões travadas com o usuário** — cada resposta do passo 2, dita como decisão.
- **Assunções a confirmar** — o que você deduziu sem perguntar.
- **Fora de escopo** — o que o usuário descartou e o que pertence a outra issue.

Cada comando imprime uma linha JSON; o erro diz o que corrigir.
`fabriquinha necessidade --help` lista todos os comandos.

O passo termina com `necessidade enviar` impresso com `enviadoEm`.

## Passo 5: relate e acompanhe

Diga ao usuário a issue criada (`I-<n>`) e que ela espera o gate do registro na página da issue.
Destaque só o que ele ainda não sabe: um achado do código, uma assunção registrada, um risco.

Se o Auditor devolver, leia o motivo em `decisoes` com `fabriquinha necessidade ver I-<n>`.
Corrija com `necessidade editar` e `necessidade evidencia` (submeter o mesmo tipo substitui o anterior), confirme com o usuário e envie de novo.

## Limites

Este fluxo **registra** a necessidade; desenho e implementação são etapas da Fabriquinha.
O código de produção fica como está.

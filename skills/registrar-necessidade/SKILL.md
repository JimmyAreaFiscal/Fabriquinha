---
name: registrar-necessidade
description: Registra na Fabriquinha uma necessidade relatada pelo usuário (problema, bug, incômodo ou funcionalidade) como demanda, com os critérios de aceite, o desenho da solução e os custos da sessão, questionando antes de escrever. Use quando o usuário pedir para registrar, abrir demanda, issue ou ticket, ou levar uma necessidade à Fabriquinha.
---

# Registrar necessidade na Fabriquinha

Você é a **ferramenta externa**: registra a demanda pelo `fabriquinha demanda`, sem sessão do pi.
O envio vai ao gate do Auditor na página da demanda; aprovada, a Fabriquinha segue sozinha para o planejamento.

Cada necessidade vira **uma demanda**.
Vários problemas no mesmo pedido viram várias demandas, uma por problema.

Os comandos, a identidade e o formato de cada JSON estão em `../../pacote-pi/skills/demanda-externa/SKILL.md` (relativo à pasta real desta skill); leia antes do passo 4.

## Passo 1: leia o código antes de perguntar

Antes da primeira pergunta, encontre e leia o que a necessidade toca: o arquivo, a função, a tela, o comando, o teste que deveria pegar isso.
Pergunte só o que o código não decide; o resto você lê.
Quando o código mostrar outra causa para o sintoma relatado, leve esse achado às perguntas.

## Passo 2: pergunte com `AskUserQuestion`

No máximo **duas rodadas** de até 4 perguntas; o que ainda faltar vira assunção escrita na descrição.

Pergunte o que muda o trabalho de verdade: regra de negócio, preferência do usuário, caso de borda que o relato não cobriu (lista vazia, item ausente, concorrência).
Nas opções, descreva a **consequência** de cada escolha, e use `preview` quando as opções forem formatos concretos.
Quando a resposta depende do que só o planejamento vai descobrir, ofereça a opção "o planejamento decide".

Em incidente ("caiu", "travou"), pergunte primeiro os fatos: quanto durou, como aconteceu, em qual ambiente, se é recorrente.

## Passo 3: reproduza e escreva as evidências

Siga as skills da Fabriquinha para cada evidência, que estão no repositório da Fabriquinha (relativo à pasta real desta skill):

- `criterios_aceite` (obrigatória): `../../pacote-pi/skills/artefato-criterios-aceite/SKILL.md`;
- `desenho_solucao` (obrigatória, com o HTML): `../../pacote-pi/skills/artefato-desenho-solucao/SKILL.md`;
- `comportamento` (opcional, recomendada em problema): `../../pacote-pi/skills/artefato-comportamento/SKILL.md`.

Elas foram escritas para o agente de dentro da Fabriquinha; aqui, quatro coisas mudam:

- a prova e o HTML ficam na pasta onde você roda o `fabriquinha`, nunca fora dela (`$FABRIQUINHA_SAIDA` não existe aqui);
- a mudança de mais de 30 arquivos vira demandas separadas, registradas por você, com `--dep` para a ordem; o `issue propor` é só do agente de dentro;
- quem confirma o conteúdo é o usuário desta conversa;
- os `arquivosPrevistos` são a sua melhor estimativa: o planejamento da Fabriquinha divide em rodadas e tickets.

Confira o formato de cada evidência com `fabriquinha demanda schema <tipo>`.

### Custos da sessão

`custos_realizados` (obrigatória) traz o uso desta sessão do Claude Code, somado do transcript por modelo.
A identidade é a mesma dos outros comandos:

```bash
export FABRIQUINHA_FERRAMENTA=claude-code FABRIQUINHA_SESSAO="$CLAUDE_CODE_SESSION_ID"
f=$(ls ~/.claude/projects/*/"$CLAUDE_CODE_SESSION_ID".jsonl | head -1)
jq -s --arg s "$CLAUDE_CODE_SESSION_ID" '{sessoes: [{ferramenta: "claude-code", sessao: $s, linhas: ([.[] | select(.message.usage and .message.id and .message.model != "<synthetic>")] | group_by(.message.id) | map(last) | group_by(.message.model) | map({provedor: "anthropic", modelo: .[0].message.model, tokens_entrada: (map(.message.usage.input_tokens) | add), tokens_saida: (map(.message.usage.output_tokens) | add), tokens_cache_leitura: (map(.message.usage.cache_read_input_tokens // 0) | add), tokens_cache_escrita: (map(.message.usage.cache_creation_input_tokens // 0) | add)}))}]}' "$f" > custos.json
```

O custo em dólares fica de fora: desconhecido não vira 0.
Os subagentes não entram na conta.

## Passo 4: registre e envie

Mostre ao usuário o título, o tipo, a descrição, os critérios e o desenho, e só registre depois do "sim" dele.

```bash
fabriquinha demanda registrar --projeto <p> --titulo "<título>" --tipo <funcionalidade|problema> --descricao desc.md [--dep I-<m>]...
fabriquinha demanda evidencia I-<n> criterios_aceite --dados criterios.json
fabriquinha demanda evidencia I-<n> desenho_solucao --dados desenho.json --arquivo desenho.html
fabriquinha demanda evidencia I-<n> comportamento --dados comp.json --arquivo <prova>...
fabriquinha demanda evidencia I-<n> custos_realizados --dados custos.json
fabriquinha demanda enviar I-<n>
```

O título diz o efeito, não a solução: "Listagem de Processos precisa trazer os Objetos junto", e não "Adicionar campo objetos[] no schema".

A descrição (`desc.md`, até 1.000 palavras) traz estas seções, nesta ordem, e omite a que estiver vazia:

- **Problema**: o que está errado ou falta hoje, com os caminhos de arquivo que você leu.
- **Decisões travadas com o usuário**: cada resposta do passo 2, dita como decisão.
- **Assunções a confirmar**: o que você deduziu sem perguntar.
- **Fora de escopo**: o que o usuário descartou e o que pertence a outra demanda.

Cada comando imprime uma linha JSON; o erro diz o que corrigir.
`fabriquinha demanda --help` lista todos os comandos.

O passo termina com `demanda enviar` impresso com a demanda enviada.

## Passo 5: relate e acompanhe

Diga ao usuário a demanda criada (`I-<n>`) e que ela espera o gate do Auditor na página da demanda.
Destaque só o que ele ainda não sabe: um achado do código, uma assunção registrada, um risco.

Se o Auditor recusar, leia o motivo com `fabriquinha demanda ver I-<n>`.
Depois do envio, só `custos_realizados` aceita nova submissão; o resto está congelado, e a correção vira uma demanda nova.

## Limites

Este fluxo **registra** a demanda; planejamento e implementação são etapas da Fabriquinha.
O código de produção fica como está.

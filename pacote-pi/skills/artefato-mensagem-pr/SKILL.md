---
name: artefato-mensagem-pr
description: Use ao produzir a evidência `mensagem_pr` da Fabriquinha.
---

# Mensagem do PR

## Para que serve

Quem revisa o PR lê o corpo no GitHub ou no Azure DevOps para decidir se aprova: ele precisa entender a mudança, achar o que conferir e saber o que ninguém verificou.
A Fabriquinha monta o PR em 10 seções fixas: o porquê da issue, as evidências e o custo ela gera sozinha; os campos da mensagem preenchem o que exige julgamento.

A mensagem é um **guia de revisão**: cada campo responde a uma pergunta que o revisor faria a quem escreveu o código.

## Como produzir

1. Leia o desenho aprovado, as decisões de revisão, os tickets concluídos e os arquivos não previstos do contexto.
2. Leia o diff da branch da issue contra a branch base, arquivo por arquivo.
3. Numa nova volta, leia o motivo da última reprovação do PR; a mensagem nova responde a ele, porque o corpo anterior é trocado inteiro.
4. Preencha cada campo como a Estrutura descreve, em Markdown, sem títulos e sem HTML: a Fabriquinha escapa `#` e `<`.
5. Escreva curto: no Azure DevOps o corpo inteiro cabe em 4.000 caracteres, e o que passar do limite é cortado do fim.

## Estrutura

Cada campo, a seção do PR em que entra e o que ele responde:

| Campo | Seção do PR | Responde |
|---|---|---|
| `titulo` | título, como `<feat\|fix>: <titulo> [I-<n>]` | O que este PR faz? |
| `oQueMudou` | 2, O que mudou | O que mudou, por que desta forma e com que limitações? |
| `decisoesNaoObvias` | 3, Decisões não óbvias | Onde o revisor estranharia a escolha? |
| `naoFeito` | 4, Fora do escopo | O que ficou de fora, além do fora do escopo do desenho? |
| `naoPrevistos` | 5, Arquivos alterados × desenho | Por que este arquivo mudou sem estar no desenho? |
| `comoRevisar` | 6, Como revisar | Em que ordem eu leio? |
| `naoVerificado` | 8, Não verificado | O que ninguém conferiu? |
| `reversao` | 9, Riscos e reversão | Como desfaço se der errado? |

`titulo`: uma frase no imperativo que se entende sozinha no histórico, sem o prefixo e sem o número da issue, que a Fabriquinha acrescenta: "Recusar aprovação de registro sem motivo".

`oQueMudou`: um parágrafo curto para cada parte: o comportamento novo, visto de fora; a abordagem e por que ela venceu a alternativa óbvia; as limitações que ficam.

`decisoesNaoObvias`: um item por escolha que parece errada ou arbitrária sem contexto, com o motivo; lista vazia vira "Nenhuma.".

`naoFeito`: o que um revisor esperaria encontrar e não está no PR, com o porquê; o fora do escopo do desenho a Fabriquinha já lista.

`naoPrevistos`: um item por arquivo da lista de não previstos do contexto, com o mesmo `caminho`; o `motivo` diz que necessidade, descoberta durante o desenvolvimento, levou à mudança.

`comoRevisar`: passos numerados pela Fabriquinha, um por item, do arquivo que dá o contexto ao detalhe: "Comece por `src/x.ts`, a regra nova; depois `src/x.test.ts`, um teste por critério."

`naoVerificado`: caminhos, plataformas ou dados que nenhum teste nem a revisão exercitou; lista vazia vira "Nada.".

`reversao`: os passos para desfazer, incluindo dado migrado ou configuração; obrigatória quando o impacto na arquitetura não é baixo.

## Antes de submeter

- [ ] O título está no imperativo, cabe em 72 caracteres e diz o que muda sem abrir o PR.
- [ ] O texto descreve o código entregue, conferido no diff, e responde à última reprovação, se houver.
- [ ] `naoPrevistos` traz exatamente os arquivos não previstos do contexto, cada um com motivo.
- [ ] `naoVerificado` está vazio só quando tudo foi de fato verificado.
- [ ] Nenhum campo repete o que a Fabriquinha gera: descrição da issue, evidências, testes, custo.

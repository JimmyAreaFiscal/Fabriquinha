---
name: artefato-mensagem-pr
description: Use ao produzir a evidência `mensagem_pr` da Fabriquinha.
---

# Mensagem do PR

## Para que serve

Quem revisa o PR da rodada (da branch da rodada para a branch da demanda) lê o corpo no GitHub ou no Azure DevOps: ele precisa entender a mudança, achar o que conferir e saber o que ninguém verificou.
A Fabriquinha monta o PR em 9 seções fixas: o porquê (título e descrição da demanda), os tickets concluídos da rodada e a autoria e o custo ela gera sozinha; os campos da mensagem preenchem o que exige julgamento.

A mensagem é um **guia de revisão**: cada campo responde a uma pergunta que o revisor faria a quem escreveu o código.

## Como produzir

1. Leia o plano, as decisões de revisão e os tickets concluídos da rodada (`fabriquinha demanda ver I-<n>`).
2. Leia o diff da branch da rodada contra a branch da demanda (`fabriquinha/I-<n>`), arquivo por arquivo.
3. Numa nova volta, leia o motivo da última reprovação do PR da rodada nas decisões de `fabriquinha demanda ver I-<n>`; a mensagem nova responde a ele, porque o corpo anterior é trocado inteiro.
4. Preencha cada campo como a Estrutura descreve, em Markdown, sem títulos e sem HTML: a Fabriquinha rebaixa os títulos em dois níveis e escapa `<`.
5. Escreva curto: no Azure DevOps o corpo inteiro cabe em 4.000 caracteres, e o que passar do limite é cortado do fim.

## Estrutura

Cada campo, a seção do PR em que entra e o que ele responde:

| Campo | Seção do PR | Responde |
|---|---|---|
| `titulo` | título, como `<feat\|fix>: <titulo> [I-<n>.R<m>]` | O que este PR faz? |
| `oQueMudou` | 2, O que mudou | O que mudou, por que desta forma e com que limitações? |
| `decisoesNaoObvias` | 3, Decisões não óbvias | Onde o revisor estranharia a escolha? |
| `naoFeito` | 4, Fora do escopo | O que ficou de fora? |
| `naoPrevistos` | fora do corpo; o Auditor lê na página da demanda | Por que este arquivo mudou sem estar nos `caminhos` do plano? |
| `comoRevisar` | 6, Como revisar | Em que ordem eu leio? |
| `naoVerificado` | 7, Não verificado | O que ninguém conferiu? |
| `reversao` | 8, Reversão | Como desfaço se der errado? |

`titulo`: uma frase no imperativo que se entende sozinha no histórico, sem o prefixo e sem o endereço da rodada, que a Fabriquinha acrescenta: "Recusar a aprovação da demanda sem motivo".

`oQueMudou`: um parágrafo curto para cada parte: o comportamento novo, visto de fora; a abordagem e por que ela venceu a alternativa óbvia; as limitações que ficam.

`decisoesNaoObvias`: um item por escolha que parece errada ou arbitrária sem contexto, com o motivo; lista vazia vira "Nenhuma.".

`naoFeito`: o que um revisor esperaria encontrar e não está no PR, com o porquê; a seção Fora do escopo mostra só esta lista, e lista vazia vira "Nada declarado.".

`naoPrevistos`: um item por arquivo que a última revisão da rodada marcou como não previsto (fora dos `caminhos` dos tickets do plano), com o mesmo `caminho`; a seção "Arquivos não previstos" do seu prompt lista exatamente esses arquivos; o `motivo` diz que necessidade, descoberta durante o desenvolvimento, levou à mudança.

`comoRevisar`: passos numerados pela Fabriquinha, um por item, do arquivo que dá o contexto ao detalhe: "Comece por `src/x.ts`, a regra nova; depois `src/x.test.ts`, um teste por critério."

`naoVerificado`: caminhos, plataformas ou dados que nenhum teste nem a revisão exercitou; lista vazia vira "Nada.".

`reversao`: os passos para desfazer, incluindo dado migrado ou configuração; escreva-a sempre que o impacto na arquitetura não for baixo, como a seção "Impacto na arquitetura" do seu prompt indica, e sem ela a seção mostra "Não declarada.".

## Antes de submeter

- [ ] O título está no imperativo, cabe em 72 caracteres e diz o que muda sem abrir o PR.
- [ ] O texto descreve o código entregue, conferido no diff, e responde à última reprovação, se houver.
- [ ] `naoPrevistos` traz exatamente os arquivos não previstos da última revisão da rodada, cada um com motivo.
- [ ] `naoVerificado` está vazio só quando tudo foi de fato verificado.
- [ ] Nenhum campo repete o que a Fabriquinha gera: descrição da demanda, tickets concluídos, custo.

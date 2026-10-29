---
name: artefato-desenho-solucao
description: Use ao produzir a evidência `desenho_solucao` da Fabriquinha.
---

# Desenho da solução

## Para que serve

O Auditor lê o HTML e os `dados` na página da demanda para aprová-la ou recusá-la, sem abrir o código: ele confere que a solução atende os critérios de aceite e cabe no que foi pedido.
Os agentes da Fabriquinha recebem só a descrição e os critérios da demanda; o desenho não chega a eles.
Por isso, toda decisão que o planejamento precisa seguir vai também na descrição da demanda.

O documento é uma **planta**: quem o lê sabe o que vai mudar, onde e por quê, antes de qualquer linha de código.

## Como produzir

1. Releia os critérios de aceite e o comportamento registrado; cada critério precisa de um lugar na solução.
2. Percorra no repositório o caminho que a solução toca, do ponto de entrada (tela, comando, rota) até onde o dado é gravado ou exibido.
3. Escolha a solução mais simples que atende todos os critérios, reaproveitando o que o projeto já tem.
4. Liste cada arquivo que a mudança vai criar, alterar ou remover, testes incluídos; é a sua melhor estimativa, e o planejamento da Fabriquinha divide o trabalho em rodadas e tickets.
5. Liste o que, perto da solução, fica de fora de propósito.
6. Escreva o HTML e salve na pasta onde você roda o `fabriquinha`, que é a única origem aceita para os anexos; escreva os `dados` com o mesmo conteúdo, e confira o formato com o schema do tipo antes de submeter.

## Estrutura

O HTML é **autocontido**: um arquivo só, começando por `<!doctype html>`, com CSS em `<style>`, diagramas em `<svg>` no próprio documento e imagens como `data:` URI.
Ele abre igual no web, num download ou anexado a outro lugar, então nada vem de fora do arquivo: nem CSS, nem fonte, nem script, nem imagem.

Seções do HTML, nesta ordem:

1. **Problema**: o comportamento atual e o que os critérios pedem, em poucas frases.
2. **Solução**: a ideia central e as decisões tomadas com o usuário na conversa, cada uma com o motivo e a alternativa descartada.
3. **Fluxo**: um diagrama em SVG do caminho da solução, do gatilho ao resultado, com os módulos e arquivos pelos nomes reais; abaixo, o mesmo fluxo em passos numerados.
4. **Critérios de aceite**: cada `CA-n` e a parte da solução que o atende.
5. **Arquivos previstos**: uma tabela com caminho, ação e motivo, a mesma lista dos `dados`.
6. **Fora de escopo**: o que a solução não faz, a mesma lista dos `dados`.

`resumo`: a solução em texto, para quem lê os `dados` sem o HTML.

- A solução em uma frase, depois as decisões que o código precisa seguir: onde entra a mudança, que padrão do projeto reusar, que nome dar.
- Markdown ou texto; os termos do código, iguais aos do HTML.

`arquivosPrevistos`, um item por arquivo ou glob:

- `caminho` a partir da raiz do repositório; um glob (`src/web/**`) só quando a mudança cobre a pasta inteira.
- `motivo`: o que muda naquele arquivo e qual critério ele atende.

`foraDeEscopo`: itens concretos e próximos da solução, que alguém poderia esperar e que ficam para outra demanda.

### Mais de 30 arquivos previstos

Um PR que altera mais de 30 arquivos é difícil de analisar.

- Com mais de 30 `arquivosPrevistos` e a alteração sem caber num só PR, divida-a em demandas separadas: este desenho fica com uma parte, e cada parte que sai é registrada como outra demanda.
  A demanda que precisa do que outra entrega a declara com `--dep` ao registrar: `fabriquinha demanda registrar ... --dep I-<n>` (o `--dep` repete, um por demanda de que ela depende).
  Escolha partes cujos arquivos saem inteiros desta demanda; arquivo que duas partes precisam tocar fica numa só, e a outra depende dela pelo `--dep`.
  Os `arquivosPrevistos` e o HTML deste desenho ficam só com a parte desta demanda.
- Com 30 ou menos, ou com mais de 30 numa alteração que cabe num PR (um glob de renomeação, por exemplo), não divida.

## Antes de submeter

- [ ] O HTML abre sozinho, sem rede, e começa por `<!doctype html>`.
- [ ] O Auditor aprova lendo só o HTML: cada critério de aceite aparece ligado a uma parte da solução.
- [ ] Cada decisão relevante do HTML foi tomada com o usuário na conversa; nenhuma é surpresa para ele.
- [ ] O diagrama usa os nomes reais de módulos e arquivos, os mesmos do texto e da tabela.
- [ ] Os `arquivosPrevistos` cobrem todo arquivo que a mudança vai tocar, testes incluídos.
- [ ] As decisões que o planejamento precisa seguir estão também na descrição da demanda.
- [ ] HTML e `dados` dizem a mesma coisa: mesma lista de arquivos, mesmo fora de escopo.
- [ ] Com mais de 30 `arquivosPrevistos` numa alteração que não cabe num PR, a mudança está dividida em demandas separadas, ligadas por `--dep`, e os `arquivosPrevistos` têm só a parte desta.

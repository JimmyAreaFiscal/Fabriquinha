---
name: artefato-desenho-solucao
description: Use ao produzir a evidência `desenho_solucao` da Fabriquinha.
---

# Desenho da solução

## Para que serve

O Auditor lê o HTML para aprovar ou reprovar o desenho, sem abrir o código: ele confere que a solução atende os critérios de aceite e cabe no que ele pediu.
Os agentes das próximas etapas trabalham com os `dados`, sem esta conversa:

- o desenvolvimento implementa a partir do `resumo`, dos `arquivosPrevistos` e do `foraDeEscopo`;
- a revisão compara os arquivos de fato alterados com os `arquivosPrevistos` e cobra o que passou do `foraDeEscopo`.

O documento é uma **planta**: quem o lê sabe o que vai mudar, onde e por quê, antes de qualquer linha de código.

## Como produzir

1. Releia os critérios de aceite e o comportamento registrado; cada critério precisa de um lugar na solução.
2. Percorra na worktree o caminho que a solução toca, do ponto de entrada (tela, comando, rota) até onde o dado é gravado ou exibido.
3. Escolha a solução mais simples que atende todos os critérios, reaproveitando o que o projeto já tem.
4. Liste cada arquivo que os tickets de desenvolvimento vão criar, alterar ou remover, testes incluídos.
5. Liste o que, perto da solução, fica de fora de propósito.
6. Escreva o HTML e salve em `$FABRIQUINHA_SAIDA`; escreva os `dados` com o mesmo conteúdo, e confira o formato com o schema do tipo antes de submeter.

## Estrutura

O HTML é **autocontido**: um arquivo só, começando por `<!doctype html>`, com CSS em `<style>`, diagramas em `<svg>` no próprio documento e imagens como `data:` URI.
Ele abre igual no web, num download ou anexado a outro lugar, então nada vem de fora do arquivo: nem CSS, nem fonte, nem script, nem imagem.

Seções do HTML, nesta ordem:

1. **Problema**: o comportamento atual e o que os critérios pedem, em poucas frases.
2. **Solução**: a ideia central e as decisões que o Auditor precisa aprovar, cada uma com o motivo e a alternativa descartada.
3. **Fluxo**: um diagrama em SVG do caminho da solução, do gatilho ao resultado, com os módulos e arquivos pelos nomes reais; abaixo, o mesmo fluxo em passos numerados.
4. **Critérios de aceite**: cada `CA-n` e a parte da solução que o atende.
5. **Arquivos previstos**: uma tabela com caminho, ação e motivo, a mesma lista dos `dados`.
6. **Fora de escopo**: o que a solução não faz, a mesma lista dos `dados`.

`resumo`: o contexto que um agente sem esta conversa precisa para implementar.

- A solução em uma frase, depois as decisões que o código precisa seguir: onde entra a mudança, que padrão do projeto reusar, que nome dar.
- Markdown ou texto; os termos do código, iguais aos do HTML.

`arquivosPrevistos`, um item por arquivo ou glob:

- `caminho` a partir da raiz do repositório; um glob (`src/web/**`) só quando a mudança cobre a pasta inteira.
- `motivo`: o que muda naquele arquivo e qual critério ele atende.
- Arquivo fora da lista que acabar alterado aparece na revisão como não previsto.

`foraDeEscopo`: itens concretos e próximos da solução, que alguém poderia esperar e que ficam para outra issue.

## Antes de submeter

- [ ] O HTML abre sozinho, sem rede, e começa por `<!doctype html>`.
- [ ] O Auditor aprova lendo só o HTML: cada critério de aceite aparece ligado a uma parte da solução.
- [ ] O diagrama usa os nomes reais de módulos e arquivos, os mesmos do texto e da tabela.
- [ ] Os `arquivosPrevistos` cobrem todo arquivo que os tickets vão tocar, testes incluídos.
- [ ] O `resumo` basta para um agente que nunca viu o HTML nem esta conversa.
- [ ] HTML e `dados` dizem a mesma coisa: mesma lista de arquivos, mesmo fora de escopo.

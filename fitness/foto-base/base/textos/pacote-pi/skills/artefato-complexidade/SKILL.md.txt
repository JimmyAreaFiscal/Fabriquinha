---
name: artefato-complexidade
description: Use ao produzir a evidência `relatorio_complexidade` da Fabriquinha.
---

# Relatório de complexidade

## Para que serve

O Auditor lê o relatório para aprovar o desenho: ele confere quanto cada caminho da solução custa em tempo e em espaço, e se uma alteração piora o que existe.
Os `dados` guardam o total de cada fluxo em Big-O, que a Fabriquinha confere; o HTML mostra de onde vem cada total, etapa por etapa.

## Como produzir

1. Liste os **fluxos**: um para cada caminho que a solução cria ou altera, seja rota, comando, job ou evento.
   Solução sem fluxo executável (só estilo ou documentação) fica com a lista vazia, e o HTML diz por quê.
2. Para cada fluxo, percorra as etapas do gatilho ao fim, lendo o código atual e o desenho da solução.
3. Dê a cada etapa o custo de tempo e o de espaço no **pior caso**.
   Espaço é o auxiliar: o que a solução aloca além da entrada.
4. Some as etapas no total do fluxo, mantendo só os termos dominantes.
5. Fluxo `alterado`: calcule também o total de antes, sobre o código atual; fluxo `novo` tem só o de depois.
6. Declare cada símbolo usado: uma letra minúscula ou nome curto, com o que ele conta.
7. Escreva o HTML e salve em `$FABRIQUINHA_SAIDA`; escreva os `dados` com os mesmos totais, e confira o formato com o schema do tipo antes de submeter.

## Estrutura

Big-O em texto simples, como o schema do tipo aceita: `O(1)`, `O(log n)`, `O(n log n)`, `O(n^2)`, `O(n + m)`, `O(n*m)`, `O(2^n)`.
Símbolos em minúsculas, expoente com `^`, sempre dentro de `O(...)`; `log` é reservado.

`variaveis`, um item por símbolo:

- `significado`: o que o símbolo conta, com a unidade do domínio: "demandas do projeto", "linhas do arquivo de sessão".
- Todo símbolo usado num Big-O está declarado, e todo declarado é usado.

`fluxos`, um item por caminho:

- `nome`: o mesmo título que o fluxo tem no HTML.
- `gatilho`: o que inicia o fluxo, pelo nome real: `GET /api/demandas/:id`, `fabriquinha demanda registrar`.
- `situacao`: `novo` ou `alterado`; `antes` só em fluxo `alterado`, e então obrigatório.
- `depois`: o total do fluxo com a solução.

O HTML é **autocontido**: um arquivo só, começando por `<!doctype html>`, com CSS em `<style>`, SVG no próprio documento e imagens como `data:` URI, nada vindo de fora do arquivo.

Seções do HTML, nesta ordem:

1. **Variáveis**: a tabela de símbolos e significados.
2. **Resumo**: uma tabela com cada fluxo, situação, antes e depois de tempo e de espaço, com as pioras destacadas.
3. **Um bloco por fluxo**, com o `nome` do JSON como título:
   - o gatilho;
   - as etapas numeradas, do gatilho ao fim, cada uma com o arquivo e a função, o custo de tempo e o de espaço e o motivo do custo;
   - o total, mostrando de qual etapa vem o termo dominante;
   - num fluxo `alterado`, as etapas de antes que mudaram e por que o total mudou.

Lista de fluxos vazia: o HTML tem só uma seção dizendo por que a solução não cria nem altera caminho executável.

## Antes de submeter

- [ ] Cada rota, comando, job ou evento criado ou alterado pelo desenho tem um fluxo, com o mesmo nome no JSON e no HTML.
- [ ] Todo custo é de pior caso, e o espaço conta só o que a solução aloca além da entrada.
- [ ] O total de cada fluxo bate com a soma das etapas do HTML.
- [ ] Os fluxos `alterado` têm o antes calculado sobre o código atual, e as pioras estão explicadas.
- [ ] Os símbolos usados e os declarados são os mesmos.
- [ ] O HTML abre sozinho, sem rede, e começa por `<!doctype html>`.

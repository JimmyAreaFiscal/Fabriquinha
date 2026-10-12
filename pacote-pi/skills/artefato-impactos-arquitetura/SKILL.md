---
name: artefato-impactos-arquitetura
description: Use ao produzir a evidência `relatorio_impactos_arquitetura` da Fabriquinha.
---

# Impactos na arquitetura

## Para que serve

O Auditor lê o relatório para aprovar o desenho: ele confere o que a solução muda na estrutura do projeto e o risco que aceita ao aprovar.
A página da issue mostra o impacto e a contagem de acoplamentos novos; o PR traz o impacto, os riscos e as mitigações para quem revisa.
Com impacto `medio` ou `alto`, a mensagem do PR passa a exigir um plano de reversão.

## Como produzir

1. Compare o desenho da solução com o código atual: módulos, pacotes, serviços externos, dados gravados e contratos públicos (rotas, comandos, formatos de arquivo).
2. Liste cada **dependência nova**: pacote, biblioteca, serviço externo, binário ou ferramenta que o projeto passa a exigir para rodar, testar ou compilar.
   Atualizar a versão de uma dependência que já existe não conta.
3. Liste cada **acoplamento novo**: um módulo que passa a importar, chamar ou ler dados de outro do qual hoje não depende.
   Chamada nova entre módulos que já se conhecem não conta.
4. Liste os **riscos**: o que pode quebrar ou ficar difícil de desfazer, cada um com a mitigação que o desenho já prevê.
5. Classifique o impacto pela tabela da Estrutura, pelo item mais grave.
6. Escreva o HTML e salve em `$FABRIQUINHA_SAIDA`; escreva os `dados` com as mesmas listas, e confira o formato com o schema do tipo antes de submeter.

## Estrutura

`impacto`:

| Nível | Quando |
|---|---|
| `baixo` | A mudança fica dentro de módulos existentes, sem dependência nova e sem mudar contrato público nem formato de dado gravado. |
| `medio` | Há dependência ou acoplamento novo, ou um contrato público muda de forma compatível com quem já o usa. |
| `alto` | Muda formato de dado gravado, quebra contrato público, troca uma peça central (banco, framework, serviço externo) ou exige migração. |

`novasDependencias`: `nome` como aparece no manifesto (`package.json`, `requirements.txt`) ou no sistema; `motivo` diz por que o que o projeto já tem não basta.

`novosAcoplamentos`: `de` e `para` são os nomes reais dos módulos ou pastas (`src/web`, `src/execucao`); `motivo` diz por que a dependência vai nesse sentido.

`riscos`: `descricao` diz o que falha e quem nota; `mitigacao` diz o que no desenho evita, detecta ou desfaz a falha.
Impacto `baixo` pode ter a lista vazia; `medio` e `alto` têm pelo menos um risco.

O HTML é **autocontido**: um arquivo só, começando por `<!doctype html>`, com CSS em `<style>`, SVG no próprio documento e imagens como `data:` URI, nada vindo de fora do arquivo.

Seções do HTML, nesta ordem:

1. **Impacto**: o nível e o motivo em uma ou duas frases, apontando o item que o definiu.
2. **Dependências e acoplamentos**: um diagrama em SVG dos módulos tocados, com as setas novas destacadas, e uma tabela de cada dependência e acoplamento novo com o motivo.
3. **Contratos e dados**: rotas, comandos e formatos gravados que mudam, ou a frase "nenhum".
4. **Riscos**: uma tabela com risco e mitigação.

## Antes de submeter

- [ ] O nível do impacto segue a tabela e é justificado pelo item mais grave.
- [ ] Cada pacote novo no manifesto e cada import novo entre módulos aparece nas listas, e nada além deles.
- [ ] Cada risco tem uma mitigação concreta, que está no desenho da solução.
- [ ] HTML e `dados` trazem as mesmas listas e o mesmo nível.
- [ ] O HTML abre sozinho, sem rede, e começa por `<!doctype html>`.

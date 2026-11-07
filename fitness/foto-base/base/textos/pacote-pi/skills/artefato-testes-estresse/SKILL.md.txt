---
name: artefato-testes-estresse
description: Use ao produzir a evidência `testes_estresse` da Fabriquinha.
---

# Testes de estresse

## Para que serve

A revisão integral da demanda precisa saber se a mudança aguenta carga, volume e entrada hostil.
Você desenha e roda os cenários cabíveis à demanda; um cenário que quebra reprova a revisão integral.

## Como produzir

1. Leia o diff inteiro da demanda e ache os pontos sensíveis: laços sobre dados do usuário, filas, arquivos grandes, concorrência, chamadas externas.
2. Desenhe um cenário por ponto: o que você exagera (volume, concorrência, tamanho, falha), e o que esperaria que continue valendo.
3. Rode cada cenário de verdade, com um comando que o revisor repete, e registre o que viu.
4. Marque `quebrou` se o limite esperado falhou (erro, travamento, estouro de tempo ou memória, dado corrompido); senão, `passou`.
5. Se nada na demanda comporta estresse, use `aplicavel: false` com `justificativa` e `cenarios` vazio. Sem justificativa o schema recusa.

## Estrutura

`dados`:

- `aplicavel`: boolean.
- `justificativa`: obrigatória se `aplicavel` é false.
- `cenarios`: pelo menos um se `aplicavel` é true; cada um com `nome`, `objetivo`, `comando`, `resultado` (`passou` ou `quebrou`) e `observado`.

A Fabriquinha calcula a aprovação: nenhum cenário `quebrou`. Não a informe.
Logs de texto podem ser anexados com `--arquivo`, sem obrigação.

```json
{
  "aplicavel": true,
  "cenarios": [
    {
      "nome": "Importação de 100 mil linhas",
      "objetivo": "A importação termina sem estourar memória nem perder linhas",
      "comando": "node scripts/estresse-importacao.js --linhas 100000",
      "resultado": "passou",
      "observado": "Terminou em 4 s, 100000 linhas gravadas, pico de 180 MB"
    }
  ]
}
```

Quando não se aplica:

```json
{ "aplicavel": false, "justificativa": "A demanda só altera textos de ajuda, sem código executável.", "cenarios": [] }
```

## Antes de submeter

- [ ] Cada cenário foi rodado, e `observado` traz números ou mensagens reais, não expectativa.
- [ ] O `comando` é repetível por quem não viu a sessão.
- [ ] Todo ponto sensível do diff tem cenário, ou a ausência está justificada.
- [ ] Um cenário que quebrou está marcado `quebrou`, sem ser reescrito até passar.
- [ ] Se `aplicavel` é false, há justificativa concreta e `cenarios` está vazio.

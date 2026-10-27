---
name: artefato-analise-seguranca
description: Use ao produzir a evidência `analise_seguranca` da Fabriquinha.
---

# Análise de segurança

## Para que serve

A revisão integral exige uma análise de segurança do diff inteiro da demanda.
O SAST da implementação não a substitui: ele olha arquivos de um ticket, e você olha as ameaças da demanda toda.
Um achado de severidade alta ou crítica reprova a revisão integral.

## Como produzir

1. Leia o diff inteiro da demanda e ache as fronteiras de confiança: entrada do usuário, arquivos, comandos, rede, segredos, permissões.
2. Para cada fronteira, escreva a ameaça plausível e a mitigação que o código já tem.
3. Onde a mitigação falta ou é fraca, registre um achado com `severidade` (`baixa`, `media`, `alta`, `critica`), o `arquivo` e a `recomendacao`.
4. Se nada na demanda toca segurança, use `aplicavel: false` com `justificativa`, e `ameacas` e `achados` vazios. Sem justificativa o schema recusa.

## Estrutura

`dados`:

- `aplicavel`: boolean.
- `justificativa`: obrigatória se `aplicavel` é false.
- `ameacas`: pelo menos uma se `aplicavel` é true; cada uma com `descricao` e `mitigacao`.
- `achados`: cada um com `descricao`, `severidade`, `arquivo` (opcional) e `recomendacao`.

A Fabriquinha calcula a aprovação: nenhum achado `alta` ou `critica`. Não a informe.
Logs de texto podem ser anexados com `--arquivo`, sem obrigação.

```json
{
  "aplicavel": true,
  "ameacas": [
    {
      "descricao": "Caminho de arquivo vindo do usuário sai da pasta permitida com ..",
      "mitigacao": "O caminho é normalizado e recusado se contém .. antes de qualquer leitura"
    }
  ],
  "achados": [
    {
      "descricao": "A mensagem de erro devolve o caminho absoluto do servidor",
      "severidade": "baixa",
      "arquivo": "src/arquivos/ler.ts",
      "recomendacao": "Devolver só o nome do arquivo ao chamador"
    }
  ]
}
```

Quando não se aplica:

```json
{ "aplicavel": false, "justificativa": "A demanda só altera textos de ajuda, sem entrada externa.", "ameacas": [], "achados": [] }
```

## Antes de submeter

- [ ] A análise cobre o diff inteiro da demanda, não só o último ticket.
- [ ] Cada achado tem severidade coerente: dado exposto, execução de código ou bypass de permissão é `alta` ou `critica`.
- [ ] Cada achado diz o arquivo e o que corrigir.
- [ ] Achado alto ou crítico não foi rebaixado para evitar a reprovação.
- [ ] Se `aplicavel` é false, há justificativa concreta e as duas listas estão vazias.

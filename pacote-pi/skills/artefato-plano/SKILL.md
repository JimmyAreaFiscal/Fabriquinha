---
name: artefato-plano
description: Use ao produzir a evidência `plano` da Fabriquinha.
---

# Plano

## Para que serve

O plano divide a demanda aprovada em rodadas (cada uma vira um PR) e tickets de implementação.
A Fabriquinha o valida na entrada e o cruza com a demanda congelada; o Auditor o aprova ou reprova, e quem executa as rodadas só enxerga a descrição da demanda, os critérios e o seu ticket do plano.

## Como produzir

1. Leia o desenho aprovado na seção "Desenho aprovado" do seu prompt (o `resumo`, os `arquivosPrevistos`, o `foraDeEscopo` e o HTML): o plano segue as decisões dele.
2. Leia os critérios de aceite da demanda e agrupe os que se verificam juntos: cada grupo é uma rodada.
3. Cada rodada cita em `criterios` só `CA-n` que a demanda tem, e entrega algo que roda e se prova sozinho.
4. Quebre cada rodada em tickets pequenos, com os `arquivos_previstos` (arquivos ou globs) que cada um toca, a partir dos `arquivosPrevistos` do desenho; todo ticket de implementação fica numa rodada.
   Arquivo alterado fora dos `arquivos_previstos` dos tickets da rodada aparece como não previsto na revisão dela.
   Mudança que só fica verde inteira (renomear ou mover pacotes junto com imports, testes e fitness) é um ticket só.
   Dividida, o primeiro ticket reprova na verificação e os seguintes ficam vazios: na I-259, o T7 não passava sem `tests/` e refez o trabalho do T8 e do T9.
5. Declare `depende` só onde a ordem importa: rodada depende de rodada, ticket depende de ticket da mesma rodada. Sem ciclo.
6. Use `e2e: true` na rodada que precisa de teste ponta a ponta.
7. O ideal é cada rodada tocar até 30 arquivos, testes incluídos: o PR dela é o que o Auditor revisa.
8. Os `arquivos_previstos` existem nos três níveis: todo arquivo previsto do ticket está na sua rodada e todo arquivo previsto da rodada está na demanda (Ticket ⊆ Rodada ⊆ Demanda).
   O plano que viola isso é recusado na submissão, com o arquivo e o nível no motivo.
   Depois da aprovação não há replanejamento: mudança de rumo é correção do Plano, nunca um plano novo.

## Estrutura

`dados` é o plano; esta evidência não tem anexos.

- `demanda_id`, `criterios` e `arquivos_previstos`: a demanda (`I-206`), todos os seus `CA-n` e os arquivos que o trabalho todo toca.
- `rodadas`: `demanda_id`, `rodada_id`, `titulo`, `e2e`, `criterios`, `arquivos_previstos`, `depende`.
- `tickets`: `demanda_id`, `ticket_id`, `rodada_id`, `titulo`, `descricao`, `arquivos_previstos`, `depende`.

O endereço público vira campos separados: `I-206.T3` é `demanda_id: "I-206"` e `ticket_id: 3`; `I-206.R2` é `demanda_id: "I-206"` e `rodada_id: 2`.
Em `depende`, cada item repete o `demanda_id` e traz o `rodada_id` ou o `ticket_id` do alvo.

```json
{
  "demanda_id": "I-206",
  "criterios": ["CA-1", "CA-2"],
  "arquivos_previstos": ["src/cadastro/**", "src/listagem/**"],
  "rodadas": [
    {
      "demanda_id": "I-206",
      "rodada_id": 1,
      "titulo": "Cadastro",
      "e2e": false,
      "criterios": ["CA-1"],
      "arquivos_previstos": ["src/cadastro/**"],
      "depende": []
    },
    {
      "demanda_id": "I-206",
      "rodada_id": 2,
      "titulo": "Listagem",
      "e2e": true,
      "criterios": ["CA-2"],
      "arquivos_previstos": ["src/listagem/**"],
      "depende": [{ "demanda_id": "I-206", "rodada_id": 1 }]
    }
  ],
  "tickets": [
    {
      "demanda_id": "I-206",
      "ticket_id": 1,
      "rodada_id": 1,
      "titulo": "Endpoint de cadastro",
      "descricao": "Cria o endpoint e valida a entrada.",
      "arquivos_previstos": ["src/cadastro/**"],
      "depende": []
    },
    {
      "demanda_id": "I-206",
      "ticket_id": 2,
      "rodada_id": 2,
      "titulo": "Tela de listagem",
      "descricao": "Lista os cadastros.",
      "arquivos_previstos": ["src/listagem/**"],
      "depende": []
    }
  ]
}
```

## Antes de submeter

- [ ] Os `arquivos_previstos` cobrem os `arquivosPrevistos` do desenho, e nada do `foraDeEscopo` entra no plano.
- [ ] Todo arquivo previsto do ticket está na sua rodada e todo o da rodada está na demanda (Ticket ⊆ Rodada ⊆ Demanda).
- [ ] Todo `CA-n` da demanda está em `criterios` do plano, e cada rodada cita só critérios que existem.
- [ ] Toda rodada tem pelo menos um ticket; nenhum `rodada_id` ou `ticket_id` se repete.
- [ ] Todo `demanda_id` é o da demanda; as dependências não formam ciclo.
- [ ] Os `arquivos_previstos` de rodadas diferentes não disputam o mesmo arquivo sem dependência entre elas.
- [ ] Cada ticket cabe em uma sessão de trabalho e a descrição basta para quem não viu a conversa.
- [ ] Cada rodada toca, idealmente, até 30 arquivos.

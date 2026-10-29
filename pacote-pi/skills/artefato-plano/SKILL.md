---
name: artefato-plano
description: Use ao produzir a evidência `plano` da Fabriquinha.
---

# Plano

## Para que serve

O plano divide a demanda aprovada em rodadas (cada uma vira um PR) e tickets de implementação.
A Fabriquinha o valida na entrada e o cruza com a demanda congelada; o Auditor o aprova ou reprova, e quem executa as rodadas só enxerga a descrição da demanda, os critérios e o seu ticket do plano.

## Como produzir

1. Leia os critérios de aceite da demanda e agrupe os que se verificam juntos: cada grupo é uma rodada.
2. Cada rodada cita em `criterios` só `CA-n` que a demanda tem, e entrega algo que roda e se prova sozinho.
3. Quebre cada rodada em tickets pequenos, com os `caminhos` (arquivos ou globs) que cada um toca; todo ticket de implementação fica numa rodada.
   Arquivo alterado fora dos `caminhos` dos tickets da rodada aparece como não previsto na revisão dela.
4. Declare `depende` só onde a ordem importa: rodada depende de rodada, ticket depende de ticket da mesma rodada. Sem ciclo.
5. Use `e2e: true` na rodada que precisa de teste ponta a ponta.

## Estrutura

`dados` é o plano; esta evidência não tem anexos.

- `demanda_id` e `criterios`: a demanda (`I-206`) e todos os seus `CA-n`.
- `rodadas`: `demanda_id`, `rodada_id`, `titulo`, `e2e`, `criterios`, `depende`.
- `tickets`: `demanda_id`, `ticket_id`, `rodada_id`, `titulo`, `descricao`, `caminhos`, `depende`.

O endereço público vira campos separados: `I-206.T3` é `demanda_id: "I-206"` e `ticket_id: 3`; `I-206.R2` é `demanda_id: "I-206"` e `rodada_id: 2`.
Em `depende`, cada item repete o `demanda_id` e traz o `rodada_id` ou o `ticket_id` do alvo.

```json
{
  "demanda_id": "I-206",
  "criterios": ["CA-1", "CA-2"],
  "rodadas": [
    { "demanda_id": "I-206", "rodada_id": 1, "titulo": "Cadastro", "e2e": false, "criterios": ["CA-1"], "depende": [] },
    {
      "demanda_id": "I-206",
      "rodada_id": 2,
      "titulo": "Listagem",
      "e2e": true,
      "criterios": ["CA-2"],
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
      "caminhos": ["src/cadastro/**"],
      "depende": []
    },
    {
      "demanda_id": "I-206",
      "ticket_id": 2,
      "rodada_id": 2,
      "titulo": "Tela de listagem",
      "descricao": "Lista os cadastros.",
      "caminhos": ["src/listagem/**"],
      "depende": []
    }
  ]
}
```

## Antes de submeter

- [ ] Todo `CA-n` da demanda está em `criterios` do plano, e cada rodada cita só critérios que existem.
- [ ] Toda rodada tem pelo menos um ticket; nenhum `rodada_id` ou `ticket_id` se repete.
- [ ] Todo `demanda_id` é o da demanda; as dependências não formam ciclo.
- [ ] Os `caminhos` de rodadas diferentes não disputam o mesmo arquivo sem dependência entre elas.
- [ ] Cada ticket cabe em uma sessão de trabalho e a descrição basta para quem não viu a conversa.

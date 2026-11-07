---
name: demanda-externa
description: Use quando o usuário pedir para registrar, completar ou enviar uma demanda à Fabriquinha pelo CLI, de fora de uma execução de agente.
---

# Demanda pelo CLI externo

Você é uma ferramenta de fora (Claude Code, Codex, pi). Registre a demanda, submeta as três evidências obrigatórias e envie; o Auditor decide no web. `decidir`, `cancelar` e `arquivar` não existem aqui.

## Identidade

Todo comando que escreve (`registrar`, `editar`, `evidencia`, `enviar`) exige a ferramenta e a sessão de origem. Defina uma vez e use a mesma em todo o fluxo: só quem registrou edita, submete e envia antes do envio.

```
export FABRIQUINHA_FERRAMENTA=claude FABRIQUINHA_SESSAO=<id da sessão no seu harness>
```

Ou passe `--ferramenta <f> --sessao <s>` em cada comando. Cada comando imprime uma linha JSON; o erro diz o que corrigir (código 1 é regra da demanda, 2 é uso inválido).

## Fluxo

1. Registrar (o `id` `I-<n>` sai no JSON; `--dep` repete; `--descricao` lê um arquivo ou `-`):

```
fabriquinha demanda registrar --projeto fabriquinha --titulo "CLI externo" --tipo funcionalidade --descricao descricao.md --dep I-12
```

2. Editar, antes do envio (título, tipo e/ou descrição):

```
fabriquinha demanda editar I-30 --titulo "Novo título"
```

3. Ver o schema do tipo e submeter a evidência (`criterios_aceite`, `desenho_solucao` e `custos_realizados` são obrigatórias). Anexos vêm da pasta onde você roda o comando:

```
fabriquinha demanda schema desenho_solucao
fabriquinha demanda evidencia I-30 criterios_aceite --dados criterios.json
fabriquinha demanda evidencia I-30 desenho_solucao --dados desenho.json --arquivo desenho.html
fabriquinha demanda evidencia I-30 custos_realizados --dados custos.json
```

`criterios.json`:

```json
{ "criterios": [{ "id": "CA-1", "dado": "um projeto", "quando": "eu registro", "entao": "recebo o I-<n>" }] }
```

`custos.json` (sessões externas; omita `custo` se desconhecido, nunca ponha 0):

```json
{ "sessoes": [{ "ferramenta": "claude", "sessao": "S1", "linhas": [{ "provedor": "anthropic", "modelo": "opus", "tokens_entrada": 1000, "tokens_saida": 200, "tokens_cache_leitura": 0, "tokens_cache_escrita": 0 }] }] }
```

4. Enviar ao Auditor; faltando evidência, o erro lista quais são:

```
fabriquinha demanda enviar I-30
```

5. Ver a demanda, com dependências, evidências (e o SHA-256 dos anexos) e se já foi enviada:

```
fabriquinha demanda ver I-30
```

Depois do envio só `custos_realizados` aceita nova submissão; o resto está congelado.

## Modo de trabalhar: sessão em aberto

**Objetivo:** transformar as mudanças que o Auditor pediu no PR em tickets de desenvolvimento.

**Passos:**

1. Leia o motivo do pedido de mudanças e o PR.
2. Converse com o Auditor até entender cada mudança.
3. Crie um ticket de desenvolvimento por mudança, na ordem em que devem ser feitos.

**Entregas:** pelo menos um ticket de desenvolvimento.

**Quando parar:** quando o Auditor concluir a sessão.

**O que não fazer:** não implemente as mudanças (as alterações da worktree são descartadas), não crie nem altere PR, não faça commit nem push, e não mexa em nada fora do seu ticket.

## CLI da Fabriquinha

O comando `fabriquinha` já sabe qual é a sua execução; cada comando imprime uma linha JSON, e o erro diz o que corrigir.

- `fabriquinha projeto ver`, `fabriquinha issue ver I-<n>` e `fabriquinha ticket ver T-<n>`: leitura.
- `fabriquinha ticket criar I-<n> --titulo <título> [--descricao <arquivo>]`, `ticket editar T-<n>` e `ticket remover T-<n>`: os tickets da sessão.
- Texto longo vai num arquivo Markdown passado em `--descricao`, ou em stdin com `-`.

## Submissão de evidências

Esta etapa não tem evidência.

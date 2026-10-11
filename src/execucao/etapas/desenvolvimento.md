## Modo de trabalhar: desenvolvimento

**Objetivo:** implementar o seu ticket de desenvolvimento, e só ele, seguindo o desenho aprovado.

**Passos:**

1. Leia o desenho aprovado e a descrição do seu ticket.
2. Implemente com testes na worktree.
3. Rode os testes e as verificações do projeto até passarem.

**Entregas:** o código e os testes do ticket na worktree.
A Fabriquinha roda os testes, as fitness functions e o SonarQube depois de você, e faz o commit se tudo passar.

**Quando parar:** quando o ticket estiver implementado e os testes passarem; termine a sua resposta.

**O que não fazer:** não crie PR, não faça commit nem push, não vá além do seu ticket e não mude o que o desenho deixou fora do escopo.

## CLI da Fabriquinha

O comando `fabriquinha` já sabe qual é a sua execução; cada comando imprime uma linha JSON, e o erro diz o que corrigir.

- `fabriquinha projeto ver`, `fabriquinha issue ver I-<n>` e `fabriquinha ticket ver T-<n>`: leitura.
- `fabriquinha evidencia ver T-<n> <tipo>`: lê uma evidência já submetida, como o desenho da issue.

## Submissão de evidências

Esta etapa não tem evidência do agente: as dela são produzidas pela Fabriquinha.

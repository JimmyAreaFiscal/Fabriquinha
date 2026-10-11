# 13 — Coletores de testes e fitness functions

**What to build:** a Fabriquinha roda os comandos de teste e as fitness functions do projeto na worktree e registra `execucao_testes` e `matriz_fitness` com `aprovada` calculada e o log de cada comando anexado. Specs: F3 §4.3 (`execucao_testes`), §4.4 (`matriz_fitness`), §6.

**Blocked by:** 05, 08

**Status:** ready-for-agent

- [ ] Executor de comando via `/bin/sh -c` com `cwd` na worktree, limite de 30 min (mata o grupo), stdout+stderr num anexo `texto` com os últimos 5 MiB.
- [ ] Roda todos os comandos mesmo após falha; comando não encontrado conta como reprovado.
- [ ] Registro via C17 com produtor `fabriquinha`, fora de transação durante a execução.
- [ ] Testes com `true`, `false` e `sleep` além do limite (limite injetável no teste).

# 18 — Retrabalho e commits humanos

**What to build:** a Fabriquinha mede que linhas escritas por um ticket foram reescritas depois, por outro ticket ou por commit humano na base, e varre a base periodicamente com cursor. Specs: F6 §4, §7 (`retrabalho`, `varredura_base`), §10.

**Blocked by:** 10, 15

**Status:** ready-for-agent

- [ ] `registrarRetrabalho(banco, ticket, sha)` com o algoritmo do F6 §4.2 (diff `-U0 -M`, blame porcelain por intervalos, commit → ticket), idempotente; ligado após o commit do ticket.
- [ ] `varrerBase(banco, projeto)` com cursor, `--no-merges`, ignorando commits de ticket, autor gravado, cursor inicial e force-push conforme F6 §4.4.
- [ ] Ligado na criação de worktree, na publicação de PR (quando existir) e uma vez por dia por projeto pelo agendador; falhas só no log.
- [ ] Testes do F6 §10 (retrabalho A/B, removido, renomeado, binário, humano, merge commit, force-push).

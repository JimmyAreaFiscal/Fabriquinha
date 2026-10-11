# 08 — Worktree da issue

**What to build:** cada issue ganha a sua worktree e branch fora do repositório, preparada com as dependências, recriável se apagada, e as etapas sem código têm suas alterações descartadas. Specs: F5 §1, §3, §6, §8 (`garantirWorktree`, `descartarAlteracoes`).

**Blocked by:** 02

**Status:** done

- [x] Caminho `<raiz>/worktrees/<projeto>/I-<n>`, branch `fabriquinha/I-<n>` a partir de `origin/<branchBase>` após `git fetch`.
- [x] Os cenários do F5 §3.1: existe e preparada; não existe; pasta apagada com branch existente; branch de sobra sem pertencer à issue é recusada.
- [x] Preparação via `/bin/sh -c`, em ordem, para no primeiro erro, limite de 30 min, log no log da execução; refaz após falha.
- [x] Descarte com `reset --hard` + `clean -fd` (mantém ignorados), registrando no log o que removeu.
- [x] Fila em memória por projeto para comandos git.
- [x] Ganchos para `varrerBase` (F6) ficam como ponto de extensão a ser ligado no ticket 18 (callback opcional em `garantirWorktree`).
- [x] Testes com git real e `origin` bare; descarte mantém `node_modules` ignorado e remove arquivo novo não ignorado.

# 15 — Commit do ticket e ciclo do desenvolvimento

**What to build:** depois do pi de um ticket de desenvolvimento, a Fabriquinha roda testes → fitness → SonarQube, faz o commit com os hooks do repositório, registra o commit e os arquivos e conclui o ticket; ao concluir o último, a issue vai para `revisao` com o ticket de revisão. Specs: F3 §7 (linha desenvolvimento); F5 §4, §7 (`commit_ticket`, `arquivo_commit`); F1 §5.1 (desenvolvimento); D4, D6.

**Blocked by:** 09, 13, 14

**Status:** done

- [x] Cadeia pós-pi do desenvolvimento, parando no primeiro reprovado (ticket falha com o motivo).
- [x] `commitarTicket`: `git add -A`; nada a commitar falha; mensagem Conventional Commits `<feat|fix>: <título> [I-n/T-m]` + descrição cortada em 72 colunas; nunca `--no-verify`; hook que reprova falha o ticket com a saída.
- [x] Commit e arquivos (`git show --numstat --name-status`) gravados na mesma transação de C7.
- [x] C7 do desenvolvimento exige commit; transição para `revisao` quando não sobra ticket de desenvolvimento não concluído.
- [x] Ponto de chamada de `registrarRetrabalho` (ligado no ticket 18).
- [x] Teste de ponta a ponta com pi falso que altera um arquivo, testes e fitness falsos e SonarQube falso.

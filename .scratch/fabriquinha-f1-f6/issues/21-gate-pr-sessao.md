# 21 — Gate do PR, encerramento da issue e sessão em aberto

**What to build:** o Auditor faz o merge do PR na plataforma; a Fabriquinha lê o estado do PR (`estadoPR`) e, com o PR lido como mergeado na mesma operação, encerra a issue com nota (C16 aprovado) e remove a worktree; ou, com o PR não mergeado, o Auditor pede mudanças com motivo (fase `ajuste_pr` e uma sessão em aberto que cria tickets de desenvolvimento e devolve a issue ao loop). Specs (versão atual): F1 C16, §5.1 (sessao); F5 §5.2, §5.3; F4 §6.6 (sessão em aberto); D5.

**Blocked by:** 11, 20

**Status:** done

- [x] `estadoPR(projeto, issue)` → `{ estado: aberto | mergeado | fechado, url, mergeadoEm?, lidoEm }` via `gh pr view` / `az repos pr show`; falha devolve a saída do comando e nada é gravado.
- [x] Encerrar (C16 aprovado, nota 1–5 obrigatória) só com o estado lido como `mergeado` logo antes da transação; pedir mudanças (C16 reprovado, motivo obrigatório, sem nota) só com o PR não mergeado.
- [x] `limpar` após encerrar: fetch da base + `varrerBase`, remove a worktree e faz prune; branches local e remota ficam; falha vira aviso, não desfaz o encerramento.
- [x] Sessão em aberto inicia com o motivo e a URL; C7 da etapa `sessao` exige ticket de desenvolvimento criado → `desenvolvimento`.
- [x] Testes com `gh`/`az` falsos: encerrar recusado com PR `OPEN`; encerrar com `MERGED` remove a worktree e mantém as branches; pedir mudanças cria o ticket `sessao`.

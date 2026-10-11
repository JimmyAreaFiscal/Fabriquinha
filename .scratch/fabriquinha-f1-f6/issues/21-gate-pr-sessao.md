# 21 — Gate do PR, merge, limpeza e sessão em aberto

**What to build:** o Auditor aprova o PR com nota (a Fabriquinha faz o merge com merge commit antes de gravar, depois limpa worktree e branches) ou reprova (fase `ajuste_pr` e uma sessão em aberto que cria tickets de desenvolvimento e devolve a issue ao loop). Specs: F1 C16, §5.1 (sessao); F5 §5.2, §5.3; F4 §6.6 (sessão em aberto). Atenção: F7 §4.6 marca o fluxo do PR como pendente de decisão; implementar conforme F1/F5 e manter o gatilho desacoplado.

**Blocked by:** 11, 20

**Status:** ready-for-agent

- [ ] `mergearPR`: lê estado, mergeia (GitHub `--merge`; Azure `--squash false --delete-source-branch true`), confere mergeado; merge bloqueado não grava decisão e devolve a mensagem da plataforma.
- [ ] C16 com nota obrigatória; aprovado → `concluida`; reprovado → `ajuste_pr` + ticket `sessao` com o motivo.
- [ ] `limpar` após o merge; falha vira aviso, não desfaz a aprovação.
- [ ] Sessão em aberto inicia com o motivo e a URL; C7 da etapa `sessao` exige ticket de desenvolvimento criado → `desenvolvimento`.
- [ ] Testes: PR já mergeado pela plataforma segue para a limpeza; merge bloqueado não grava decisão.

# 20 — Encerramento e publicação do PR

**What to build:** no encerramento, o agente submete `mensagem_pr` e `video_explicativo`; a Fabriquinha descarta alterações, registra o relatório de produtividade, monta o PR padronizado (10 seções, condensado ao limite da hospedagem), faz push, cria ou atualiza o PR e registra `pr_aberto`; a issue vai para `aprovacao_pr`. Specs: F3 §4.5–§4.7, §7 (linha encerramento); F5 §5.0, §5.1; F6 §6.4; F1 §5.1 (encerramento).

**Blocked by:** 16, 19

**Status:** ready-for-agent

- [ ] Schemas de `mensagem_pr` (com regras cruzadas) e `video_explicativo`.
- [ ] Título e corpo do PR exatamente nas 10 seções do F3 §4.6; condensação do §4.7 na ordem definida, sem condensar seções do agente antes das geradas.
- [ ] `publicarPR` cria ou atualiza no GitHub (`gh`) e no Azure DevOps (`az`), com a conferência de PR criado fora da Fabriquinha (F5 §5.0).
- [ ] `pr_aberto` com o corpo completo anexado; `relatorio_produtividade` com o HTML anexado.
- [ ] Testes com `origin` bare e `gh`/`az` falsos no `PATH`.

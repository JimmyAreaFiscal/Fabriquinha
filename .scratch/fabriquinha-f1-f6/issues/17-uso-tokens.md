# 17 — Uso de tokens e custo por execução

**What to build:** depois de todo término de execução (inclusive órfãs no reinício), a Fabriquinha soma tokens e custo da sessão do pi por provedor e modelo, só das entradas dentro da janela da execução. Specs: F6 §3, §7 (`uso`), §10 (coleta e sessão compartilhada).

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] `coletarUso(banco, execucao)` idempotente, com as entradas do F6 §3.1 e a janela do §3.2; linha JSON inválida ignorada; mais de um arquivo para o mesmo ID é erro; sessão inexistente não é erro.
- [ ] Chamado pelo F4 após todo C6 e no reinício; falha só vai para o log.
- [ ] Testes com JSONL de exemplo (dois modelos, `toolResult` e `compaction` com `usage`, entrada fora da janela, última linha cortada) e duas execuções na mesma sessão.

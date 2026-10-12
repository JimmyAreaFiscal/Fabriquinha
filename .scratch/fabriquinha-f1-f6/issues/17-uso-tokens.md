# 17 — Uso de tokens e custo por execução

> Atualizado em 2026-10-11 por ordem do Auditor (Jimmy), para refletir mudanças nas specs feitas depois da criação deste ticket: o uso dos subagentes da extensão `subagents` do Auditor fica em `details.results[].usage` do `toolResult` (não há sessão própria deles) e entra na soma; entradas `custom` são ignoradas (F6 §3.1, P1 §2.2).

**What to build:** depois de todo término de execução (inclusive órfãs no reinício), a Fabriquinha soma tokens e custo da sessão do pi por provedor e modelo, só das entradas dentro da janela da execução. Specs: F6 §3, §7 (`uso`), §10 (coleta e sessão compartilhada).

**Blocked by:** 10

**Status:** done

- [x] `coletarUso(banco, execucao)` idempotente, com as entradas do F6 §3.1 e a janela do §3.2; linha JSON inválida ignorada; mais de um arquivo para o mesmo ID é erro; sessão inexistente não é erro.
- [x] Soma `details.results[].usage` de cada `toolResult` com `toolName = subagent`, atribuído a `details.results[].model` quando vier; entradas `custom` ignoradas.
- [x] Chamado pelo F4 após todo C6 e no reinício; falha só vai para o log.
- [x] Testes com JSONL de exemplo (dois modelos, `toolResult` e `compaction` com `usage`, `toolResult` de `subagent` com dois resultados, entrada `custom` grande, entrada fora da janela, última linha cortada) e duas execuções na mesma sessão.

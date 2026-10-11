# 03 — Issue, dependências e aplicação de comandos

**What to build:** registrar uma issue (que nasce em `registro` com o ticket de registro), editar seus campos, gerenciar dependências sem ciclo e arquivar concluídas, tudo pelo caminho único `comIssue` que carrega o agregado, aplica o comando puro do F1 e grava só a diferença numa transação, registrando o comando. Specs: F1 §3.2, §3.4, §3.5, §4.1, §5 (C1–C4, C18), §6, §7; F2 §3.3, §3.5, §4 (`issue`, `issue_dep`, `ticket`), §6; F6 §5.1 e §7 (`comando`).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Comandos do F1 são funções puras `(agregado, entrada, ator, contexto) → agregado` que lançam `ErroDeRegra`/`ErroDeEscopo`.
- [ ] C1, C2, C3, C4 e C18 com as pré-condições e os escopos de ator do F1 (agente só no próprio ticket/issue e só com execução em andamento — o fato chega por contexto).
- [ ] Dependências: sem ciclo (CTE recursiva `alcancaveis`), sem autorreferência, entre projetos; C3/C4 idempotentes.
- [ ] `comIssue(banco, issue, nome, ator, comando)`: `BEGIN IMMEDIATE`, carga do agregado, fatos externos do F2 §3.5, diff linha a linha por igualdade de JSON, linha em `comando` com a fase de antes.
- [ ] `registrarIssue`, `arquivarConcluidas` e `agregado(banco, issue)` do F2 §6.
- [ ] Um teste por constraint do banco (insert direto em SQL que viola a invariante falha no SQLite).

# 14 — Coletor do SonarQube

**What to build:** a Fabriquinha analisa a worktree no SonarQube local e registra `relatorio_sonar`, aprovado só com zero issue aberta nos arquivos alterados; SonarQube fora do ar faz o ticket falhar com a mensagem e o comando para subir o servidor. Specs: F3 §4.3 (`relatorio_sonar`), §6 (linha SonarQube); regra do `sonar_gate.py` da skill `commit` do Auditor.

**Blocked by:** 05, 08

**Status:** ready-for-agent

- [ ] Confere `api/system/status`, roda o `sonar-scanner-cli` em Docker sobre a worktree, espera a tarefa do Compute Engine, busca issues abertas nos arquivos alterados contra `HEAD` (versionados e não versionados).
- [ ] `SONAR_HOST_URL` e `SONAR_TOKEN` do ambiente; `projectKey` do projeto.
- [ ] Teste unitário com servidor HTTP falso; teste de integração separado contra o SonarQube local (depende de Docker), fora da suíte padrão.

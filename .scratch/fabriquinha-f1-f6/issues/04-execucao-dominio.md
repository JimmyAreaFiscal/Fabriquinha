# 04 — Execução de ticket no domínio

**What to build:** o ciclo de vida de execuções e tickets no domínio e no banco: iniciar e terminar execução, falhar e reabrir ticket, override de modelo e consulta, com o D8 (uma execução autônoma por vez) garantido também sob corrida entre processos. Specs: F1 §3.5, §3.6, §3.10, §4.2, §4.3, §5 (C5, C6, C8, C9, C20, C21), §6 (invariantes 1–3); F2 §4 (`execucao`, índices), §7; F4 §10 (`pgid_pi`, `instrucao`).

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Tabela `execucao` com CHECKs e índices únicos do F2 (uma em andamento por ticket; uma autônoma em andamento no sistema).
- [ ] C5 com todas as pré-condições (fase × etapa, modo × etapa, deps concluídas, D8, interativo aceita `em_execucao`) e consumo de `ticket.instrucao`.
- [ ] C6, C8 (remove tickets de desenvolvimento abertos criados pelo ticket e a decisão de revisão dele), C9, C20, C21.
- [ ] Função pura que resolve o modelo da execução na ordem do F1 §3.10.
- [ ] Teste de concorrência: dois processos tentam iniciar execução autônoma ao mesmo tempo; um consegue e o outro recebe `ErroDeRegra`.

# 22 — Visão por mês

**What to build:** consumo e volume de trabalho por mês, de todos os projetos ou de um só. Specs: F6 §5.7, §8 (`metricasPorMes`), §10 (visão por mês).

**Blocked by:** 19, 20

**Status:** ready-for-agent

- [ ] `metricasPorMes(banco, { projeto?, ate, meses })` validado por `MetricasMes`, um item por mês do mais antigo até `ate`.
- [ ] Regras de entrada no mês do F6 §5.7, no fuso do serviço.
- [ ] Testes do F6 §10 (execução de 31/01, PR aberto em janeiro e atualizado em fevereiro, ticket removido, filtro por projeto).

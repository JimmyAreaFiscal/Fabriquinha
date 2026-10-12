# 22 — Visão por mês

> Atualizado em 2026-10-11 por ordem do Auditor (Jimmy), para refletir mudanças nas specs feitas depois da criação deste ticket: a visão por mês recebe o período `de`/`ate`, ganhou `notaPR` e `etapas` por mês, e entrou a visão por issue no período (F6 §5.7, §5.8, §8); a nota do mês é a das issues encerradas no mês.

**What to build:** consumo e volume de trabalho por mês, de todos os projetos ou de um só, e os números por issue no mesmo período. Specs: F6 §5.7, §5.8, §8 (`metricasPorMes`, `metricasPorIssue`), §10 (visão por mês).

**Blocked by:** 19, 20

**Status:** done

- [x] `metricasPorMes(banco, { projeto?, de, ate })` validado por `MetricasMes`, um item por mês de `de` até `ate`, com `notaPR` (média das notas das issues encerradas no mês e quantas notas) e `etapas` (consumo, execuções, falhas, reprovações e duração por etapa).
- [x] `metricasPorIssue(banco, { projeto?, de, ate })` validado por `MetricasIssuePeriodo`: uma linha por issue com execução iniciada no período; `fase` e `notaPR` são o estado atual.
- [x] Regras de entrada no mês do F6 §5.7, no fuso do serviço.
- [x] Testes do F6 §10 (execução de 31/01, PR aberto em janeiro e atualizado em fevereiro, ticket removido, filtro por projeto), mais: nota de issue encerrada em fevereiro conta em fevereiro; pedido de mudanças não gera nota; issue sem execução no período fica fora da visão por issue.

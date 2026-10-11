# 19 — Métricas da issue e relatório de produtividade

**What to build:** a Fabriquinha calcula as métricas do diagrama de uma issue (M1–M7 e apoio por etapa) e gera o relatório de produtividade em JSON e HTML autocontido. Specs: F6 §2, §5.1–§5.6, §6, §8 (`metricasDaIssue`, `relatorio`).

**Blocked by:** 16, 17, 18

**Status:** ready-for-agent

- [ ] `metricasDaIssue(banco, issue)` validado pelo schema `MetricasIssue`.
- [ ] Correções (M2, M3) a partir de `decisao` e `comando`; exigências (M5); bugs em arquivos revisados (M6); notas (M7); números do desenho; apoio por etapa; consultas separadas.
- [ ] `relatorio(banco, issue)` recoleta uso e retrabalho antes de gerar; HTML com as 6 seções, sem `src`/`href` externos.
- [ ] Testes do F6 §10 (bugs, correções, relatório).

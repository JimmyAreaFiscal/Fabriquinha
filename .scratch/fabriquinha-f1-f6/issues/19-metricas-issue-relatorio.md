# 19 — Métricas da issue e relatório de produtividade

> Atualizado em 2026-10-11 por ordem do Auditor (Jimmy), para refletir mudanças nas specs feitas depois da criação deste ticket: a nota (M7) passou a ser uma por issue, dada pelo Auditor ao encerrar a issue; pedir mudanças não leva nota (F1 C16, F6 §5.4, `notaPR` em `MetricasIssue`).

**What to build:** a Fabriquinha calcula as métricas do diagrama de uma issue (M1–M7 e apoio por etapa) e gera o relatório de produtividade em JSON e HTML autocontido. Specs: F6 §2, §5.1–§5.6, §6, §8 (`metricasDaIssue`, `relatorio`).

**Blocked by:** 16, 17, 18

**Status:** done

- [x] `metricasDaIssue(banco, issue)` validado pelo schema `MetricasIssue`.
- [x] Correções (M2, M3) a partir de `decisao` e `comando`; exigências (M5); bugs em arquivos revisados (M6); nota (M7: `notaPR`, a da decisão `pr` aprovada, `null` até o encerramento); números do desenho; apoio por etapa; consultas separadas.
- [x] `relatorio(banco, issue)` recoleta uso e retrabalho antes de gerar; HTML com as 6 seções, sem `src`/`href` externos.
- [x] Testes do F6 §10 (bugs, correções, relatório).

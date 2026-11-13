# Referência de desempenho das rotas de leitura

Gerado por `npm run estresse:referencia`; não edite à mão.
Medida em 2026-11-13T13:34:11.058Z, em Intel(R) Core(TM) i9-14900HX, Node v22.23.2.
Cada rota: 20 chamadas seguidas para os tempos e 1 chamada antes delas para contar as execuções SQL.

## pequeno: 30 demandas em 3 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 4.1 | 5.2 | 104 |
| Início | `/api/despacho` | 1.7 | 1.8 | 0 |
| Board | `/api/demandas` | 7.2 | 8.5 | 459 |
| Demanda | `/api/demandas/I-29` | 2.5 | 2.8 | 36 |
| Projeto | `/api/projetos` | 1.7 | 1.9 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 4.3 | 5.8 | 183 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 2.1 | 2.5 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 7.6 | 8.4 | 452 |
| Histórico | `/api/sessoes/sessao-I-29-T1` | 2.0 | 2.2 | 23 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 13.2 | 14.9 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 11.0 | 11.7 | 688 |

## médio: 300 demandas em 12 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 12.4 | 13.3 | 494 |
| Início | `/api/despacho` | 1.5 | 1.7 | 0 |
| Board | `/api/demandas` | 45.0 | 63.9 | 4509 |
| Demanda | `/api/demandas/I-297` | 2.5 | 2.9 | 36 |
| Projeto | `/api/projetos` | 1.7 | 1.8 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 22.3 | 23.3 | 1668 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 4.3 | 4.7 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 57.9 | 62.0 | 4502 |
| Histórico | `/api/sessoes/sessao-I-297-T1` | 2.1 | 2.4 | 23 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 95.6 | 99.3 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 90.1 | 94.3 | 6386 |

## grande: 3000 demandas em 24 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 164.4 | 173.2 | 4544 |
| Início | `/api/despacho` | 1.4 | 1.7 | 0 |
| Board | `/api/demandas` | 933.6 | 942.6 | 45009 |
| Demanda | `/api/demandas/I-2999` | 6.8 | 7.9 | 36 |
| Projeto | `/api/projetos` | 1.8 | 1.9 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 389.1 | 403.5 | 16518 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 32.3 | 35.4 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 1071.7 | 1095.2 | 45002 |
| Histórico | `/api/sessoes/sessao-I-2999-T1` | 4.0 | 4.5 | 23 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 804.5 | 821.3 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 747.3 | 771.9 | 31818 |

# Referência de desempenho das rotas de leitura

Gerado por `npm run estresse:referencia`; não edite à mão.
Medida em 2026-11-13T16:55:13.798Z, em Intel(R) Core(TM) i9-14900HX, Node v22.23.2.
Cada rota: 20 chamadas seguidas para os tempos e 1 chamada antes delas para contar as execuções SQL.

## pequeno: 30 demandas em 3 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 4.0 | 5.3 | 34 |
| Menu | `/api/pendencias/quantidade` | 2.3 | 2.5 | 16 |
| Início | `/api/despacho` | 1.6 | 1.8 | 0 |
| Board | `/api/demandas` | 5.6 | 7.0 | 19 |
| Demanda | `/api/demandas/I-29` | 2.3 | 2.5 | 37 |
| Projeto | `/api/projetos` | 1.8 | 3.0 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 2.1 | 2.2 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 2.0 | 2.3 | 15 |
| Histórico | `/api/sessoes?escopo=historico` | 7.2 | 9.6 | 12 |
| Histórico | `/api/sessoes/sessao-I-29-T1` | 2.1 | 2.2 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 5.9 | 7.2 | 15 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 4.3 | 6.1 | 12 |

## médio: 300 demandas em 12 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 9.8 | 14.3 | 34 |
| Menu | `/api/pendencias/quantidade` | 4.7 | 5.3 | 16 |
| Início | `/api/despacho` | 1.6 | 1.7 | 0 |
| Board | `/api/demandas` | 35.4 | 49.7 | 19 |
| Demanda | `/api/demandas/I-297` | 2.7 | 3.0 | 37 |
| Projeto | `/api/projetos` | 1.7 | 1.8 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 3.4 | 4.9 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 3.5 | 4.3 | 15 |
| Histórico | `/api/sessoes?escopo=historico` | 47.2 | 51.0 | 12 |
| Histórico | `/api/sessoes/sessao-I-297-T1` | 2.2 | 2.7 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 26.0 | 30.6 | 15 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 23.5 | 24.8 | 12 |

## grande: 3000 demandas em 24 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 74.6 | 90.4 | 34 |
| Menu | `/api/pendencias/quantidade` | 25.1 | 25.5 | 16 |
| Início | `/api/despacho` | 1.5 | 1.7 | 0 |
| Board | `/api/demandas` | 325.3 | 355.9 | 19 |
| Demanda | `/api/demandas/I-2999` | 6.8 | 7.8 | 37 |
| Projeto | `/api/projetos` | 1.7 | 1.8 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 16.9 | 19.0 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 22.7 | 26.3 | 15 |
| Histórico | `/api/sessoes?escopo=historico` | 471.9 | 506.6 | 12 |
| Histórico | `/api/sessoes/sessao-I-2999-T1` | 4.0 | 4.3 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 143.1 | 177.3 | 15 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 126.6 | 147.7 | 12 |

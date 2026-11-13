# Referência de desempenho das rotas de leitura

Gerado por `npm run estresse:referencia`; não edite à mão.
Medida em 2026-11-13T16:25:28.335Z, em Intel(R) Core(TM) i9-14900HX, Node v22.23.2.
Cada rota: 20 chamadas seguidas para os tempos e 1 chamada antes delas para contar as execuções SQL.

## pequeno: 30 demandas em 3 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 3.8 | 4.9 | 54 |
| Menu | `/api/pendencias/quantidade` | 2.2 | 2.5 | 16 |
| Início | `/api/despacho` | 1.7 | 1.8 | 0 |
| Board | `/api/demandas` | 5.2 | 6.2 | 19 |
| Demanda | `/api/demandas/I-29` | 2.3 | 2.4 | 38 |
| Projeto | `/api/projetos` | 1.7 | 1.9 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 2.1 | 2.5 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 2.1 | 2.4 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 6.5 | 9.5 | 12 |
| Histórico | `/api/sessoes/sessao-I-29-T1` | 2.5 | 3.8 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 13.2 | 13.9 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 11.1 | 12.7 | 688 |

## médio: 300 demandas em 12 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 11.2 | 12.4 | 54 |
| Menu | `/api/pendencias/quantidade` | 4.2 | 5.4 | 16 |
| Início | `/api/despacho` | 1.5 | 1.7 | 0 |
| Board | `/api/demandas` | 32.1 | 51.4 | 19 |
| Demanda | `/api/demandas/I-297` | 2.5 | 2.6 | 38 |
| Projeto | `/api/projetos` | 1.6 | 1.8 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 3.1 | 3.4 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 4.4 | 4.8 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 45.1 | 48.3 | 12 |
| Histórico | `/api/sessoes/sessao-I-297-T1` | 2.0 | 2.3 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 95.4 | 109.8 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 90.2 | 93.7 | 6408 |

## grande: 3000 demandas em 24 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 227.4 | 259.9 | 54 |
| Menu | `/api/pendencias/quantidade` | 46.6 | 55.4 | 16 |
| Início | `/api/despacho` | 1.5 | 1.6 | 0 |
| Board | `/api/demandas` | 596.4 | 956.0 | 19 |
| Demanda | `/api/demandas/I-2999` | 8.7 | 11.9 | 38 |
| Projeto | `/api/projetos` | 1.7 | 1.8 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 17.3 | 18.4 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 37.7 | 41.6 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 517.0 | 536.9 | 12 |
| Histórico | `/api/sessoes/sessao-I-2999-T1` | 4.5 | 6.5 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 898.8 | 913.8 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 816.3 | 838.8 | 31840 |

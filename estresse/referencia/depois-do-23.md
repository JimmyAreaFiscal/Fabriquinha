# Referência de desempenho das rotas de leitura

Gerado por `npm run estresse:referencia`; não edite à mão.
Medida em 2026-11-13T16:11:50.908Z, em Intel(R) Core(TM) i9-14900HX, Node v22.23.2.
Cada rota: 20 chamadas seguidas para os tempos e 1 chamada antes delas para contar as execuções SQL.

## pequeno: 30 demandas em 3 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 5.5 | 8.7 | 54 |
| Início | `/api/despacho` | 1.5 | 1.8 | 0 |
| Board | `/api/demandas` | 6.2 | 7.7 | 19 |
| Demanda | `/api/demandas/I-29` | 2.3 | 2.6 | 38 |
| Projeto | `/api/projetos` | 1.7 | 1.8 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 2.1 | 2.2 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 2.3 | 2.5 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 7.4 | 8.0 | 12 |
| Histórico | `/api/sessoes/sessao-I-29-T1` | 2.1 | 2.3 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 16.2 | 16.6 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 13.2 | 14.1 | 688 |

## médio: 300 demandas em 12 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 12.7 | 13.9 | 54 |
| Início | `/api/despacho` | 1.5 | 1.6 | 0 |
| Board | `/api/demandas` | 38.6 | 57.0 | 19 |
| Demanda | `/api/demandas/I-297` | 2.8 | 3.0 | 38 |
| Projeto | `/api/projetos` | 1.6 | 1.7 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 3.3 | 4.4 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 5.4 | 7.2 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 51.9 | 67.5 | 12 |
| Histórico | `/api/sessoes/sessao-I-297-T1` | 2.3 | 2.8 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 110.1 | 117.4 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 104.6 | 123.1 | 6386 |

## grande: 3000 demandas em 24 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 244.0 | 267.5 | 54 |
| Início | `/api/despacho` | 2.5 | 7.2 | 0 |
| Board | `/api/demandas` | 563.4 | 922.3 | 19 |
| Demanda | `/api/demandas/I-2999` | 10.0 | 14.6 | 38 |
| Projeto | `/api/projetos` | 1.7 | 2.2 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 19.1 | 21.9 | 28 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 40.1 | 64.5 | 35 |
| Histórico | `/api/sessoes?escopo=historico` | 605.1 | 734.6 | 12 |
| Histórico | `/api/sessoes/sessao-I-2999-T1` | 5.3 | 7.3 | 24 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 984.5 | 1029.1 | 332 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 899.9 | 962.1 | 31818 |

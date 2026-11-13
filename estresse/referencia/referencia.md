# Referência de desempenho das rotas de leitura

Gerado por `npm run estresse:referencia`; não edite à mão.
Medida em 2026-11-12T23:39:15.694Z, em Intel(R) Core(TM) i9-14900HX, Node v22.23.2.
Cada rota: 20 chamadas seguidas para os tempos e 1 chamada antes delas para contar as execuções SQL.

## pequeno: 30 demandas em 3 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 8.5 | 10.4 | 313 |
| Início | `/api/despacho` | 1.5 | 1.7 | 0 |
| Board | `/api/demandas` | 11.7 | 13.2 | 693 |
| Demanda | `/api/demandas/I-29` | 3.2 | 3.6 | 99 |
| Projeto | `/api/projetos` | 1.7 | 1.9 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 27.4 | 31.5 | 1188 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 2.0 | 2.2 | 16 |
| Histórico | `/api/sessoes?escopo=historico` | 66.2 | 73.0 | 3535 |
| Histórico | `/api/sessoes/sessao-I-29-T1` | 2.2 | 2.4 | 32 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 8.4 | 8.9 | 159 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 6.8 | 7.9 | 522 |

## médio: 300 demandas em 12 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 46.9 | 50.4 | 2154 |
| Início | `/api/despacho` | 1.5 | 1.6 | 0 |
| Board | `/api/demandas` | 83.1 | 87.4 | 6246 |
| Demanda | `/api/demandas/I-297` | 3.4 | 3.7 | 99 |
| Projeto | `/api/projetos` | 1.7 | 1.8 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 228.7 | 234.4 | 12039 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 4.8 | 5.1 | 16 |
| Histórico | `/api/sessoes?escopo=historico` | 692.9 | 805.9 | 35512 |
| Histórico | `/api/sessoes/sessao-I-297-T1` | 2.3 | 2.6 | 32 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 126.0 | 135.2 | 159 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 50.2 | 54.3 | 4925 |

## grande: 3000 demandas em 24 meses

| Tela | Rota | p50 (ms) | p95 (ms) | Execuções SQL |
| --- | --- | --: | --: | --: |
| Início | `/api/inicio` | 1766.7 | 1801.0 | 21921 |
| Início | `/api/despacho` | 1.4 | 1.6 | 0 |
| Board | `/api/demandas` | 2300.2 | 4943.3 | 63003 |
| Demanda | `/api/demandas/I-2999` | 9.9 | 11.1 | 99 |
| Projeto | `/api/projetos` | 1.9 | 2.1 | 19 |
| Projeto | `/api/projetos/loja/demandas?concluidas=false&arquivadas=false&canceladas=false` | 3552.1 | 7586.9 | 120074 |
| Projeto | `/api/metricas?projeto=loja&de=2026-11&ate=2026-11` | 195.7 | 202.6 | 16 |
| Histórico | `/api/sessoes?escopo=historico` | 10164.0 | 10571.2 | 355681 |
| Histórico | `/api/sessoes/sessao-I-2999-T1` | 2.3 | 3.2 | 32 |
| Métricas | `/api/metricas?de=2025-12&ate=2026-11` | 6906.5 | 7080.4 | 159 |
| Métricas | `/api/metricas/demandas?de=2025-12&ate=2026-11` | 235.9 | 260.3 | 24543 |

# 16 — Revisão

**What to build:** antes do pi da revisão, a Fabriquinha coleta `arquivos_alterados` (diff × desenho aprovado) e `matriz_fitness`; o agente revisor submete `explicacao_fitness` e `comprovacao_criterios` e registra a decisão; a revisão aprovada leva a `encerramento`, a reprovada volta a `desenvolvimento` com os tickets exigidos. Specs: F3 §4.4, §7 (linha revisao), §8; F5 `diffDaIssue`; F1 C14, §5.1 (revisao).

**Blocked by:** 15

**Status:** done

- [x] `diffDaIssue` de `merge-base(origin/<branchBase>, HEAD)` até `HEAD`; `previsto` por `path.matchesGlob` contra `arquivosPrevistos` do último desenho concluído; `previstosNaoTocados`.
- [x] Schemas de `explicacao_fitness` e `comprovacao_criterios` com as regras cruzadas do F3 §4.4.
- [x] C14 grava ou substitui a decisão de revisão; C8 passa a remover também a decisão de revisão do ticket que falhou (pendente desde o ticket 04).
- [x] C7 da revisão com as regras do F1 §5.1 e do F3 §8.
- [x] Descarte das alterações após o pi.
- [x] Teste de ponta a ponta com pi falso: revisão aprovada e revisão reprovada que cria ticket.

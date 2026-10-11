# 01 — Fundação do pacote e do banco

**What to build:** o pacote Node/TypeScript da Fabriquinha com as ferramentas de qualidade e a abertura do banco: `abrir(raiz?)` cria a raiz, abre o SQLite, aplica os PRAGMAs e as migrações. Inclui os primitivos zod do domínio, os erros `ErroDeRegra`/`ErroDeEscopo` e a sequência de IDs. Specs: visão geral §4–§6 (D1, D2), F1 §3.1, §7, F2 §2, §3.1, §3.4, §3.6, §3.7.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Node ≥ 22.13 rodando TypeScript direto (type stripping), `node:test` como runner, `tsc --noEmit` estrito, lint com zero warnings, formatação verificável e cobertura; tudo exposto como scripts do pacote.
- [x] `sonar-project.properties` com `sonar.projectKey=Fabriquinha` (já criado; manter `sonar.exclusions=prototipos/**`).
- [x] Fitness function no próprio repositório: o módulo de domínio (F1) não importa nada de I/O (`node:*` de I/O, banco, outros módulos da Fabriquinha).
- [x] `abrir(raiz?)` usa `$FABRIQUINHA_ROOT` ou `~/fabriquinha`; diretórios `0700`, arquivos `0600`; PRAGMAs `WAL`, `foreign_keys`, `busy_timeout=5000`, `synchronous=NORMAL` em toda conexão.
- [x] Migrações ordenadas aplicadas na abertura, cada uma na sua transação, versão em `PRAGMA user_version`; reabrir não reaplica.
- [x] Listas dos `CHECK ... IN (...)` geradas dos enums zod (`Fase`, `Etapa` etc.).
- [x] Escrita em `BEGIN IMMEDIATE` com rollback que propaga o erro original; tabela `sequencia` e `novoId(tipo)` dentro da transação.
- [x] Primitivos zod de F1 §3.1 (Id, Instante, Titulo, Markdown ≤ 1000 palavras, Motivo, Slug, Modelo, Etapa, Fase) com testes.
- [x] `ErroDeRegra` e `ErroDeEscopo` com mensagem de uma frase dizendo o que faltou e como resolver.

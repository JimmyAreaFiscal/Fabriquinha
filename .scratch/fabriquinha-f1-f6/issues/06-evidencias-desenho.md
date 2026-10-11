# 06 — Evidências do desenho

**What to build:** o agente do desenho submete `desenho_solucao`, `prototipo`, `relatorio_complexidade` e `relatorio_impactos_arquitetura` com validação completa, incluindo a gramática Big-O e a conferência das variáveis. Specs: F3 §4.2 (incluindo "Padrão de registro da complexidade").

**Blocked by:** 05

**Status:** done

- [x] Os 4 schemas de `dados` e regras de arquivo do F3 §4.2, com `CaminhoRelativo` (glob, sem `..`, sem absoluto) e `temClasse`.
- [x] Parser Big-O descendente recursivo com a gramática do F3; teste com todos os exemplos válidos e recusados da spec.
- [x] Todo símbolo usado está declarado em `variaveis` e todo declarado é usado; `antes` presente se e somente se `situacao = alterado`.
- [x] `prototipo` obrigatório só quando a issue é `funcionalidade`.
- [x] Um teste por schema com exemplo válido e os inválidos mais prováveis de um agente.

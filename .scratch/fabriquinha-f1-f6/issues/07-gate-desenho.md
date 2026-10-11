# 07 — Gate de desenho

**What to build:** o desenho concluído propõe tickets de desenvolvimento e leva a issue a `aprovacao_desenho`; o Auditor ajusta os tickets e aprova (fase `desenvolvimento`) ou reprova (novo ticket de desenho com o motivo). Specs: F1 §5 (C7 para desenho, C11, C12, C13, C15), §5.1; F2 §4 (`decisao`).

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Tabela `decisao` com os CHECKs do F2.
- [ ] C7 genérico (evidências obrigatórias do catálogo, sem execução em andamento) com a regra do desenho: criou ao menos um ticket de desenvolvimento → `aprovacao_desenho`.
- [ ] C11, C12, C13 com escopo de ator (agente só edita/remove os que a sua execução criou; `modelo` só pelo Auditor; Auditor só em `aprovacao_desenho`).
- [ ] C15 aprovado exige ticket de desenvolvimento aberto; reprovado remove os abertos, volta a `desenho` com novo ticket contendo o motivo.
- [ ] Mensagens de erro no formato do F1 §7 (ex.: evidência faltando com o comando para submeter).

# 05 — Evidências do agente e gate de registro

**What to build:** o agente do registro submete `comportamento` e `criterios_aceite` (dados + arquivos), a Fabriquinha valida com mensagens que dizem o campo a corrigir, guarda os arquivos por conteúdo e grava os metadados; o Auditor aprova ou devolve o registro, e a aprovação leva a issue a `desenho` com o ticket de desenho. Specs: F1 §3.8, §3.9, C10, C17; F2 §4 (`evidencia`, `evidencia_arquivo`), §5; F3 §1–§3, §4.1, §5, §9.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Armazenamento por SHA-256 (`guardarArquivo`, `caminhoArquivo`): temporário no mesmo diretório, `fsync`, `rename`; deduplicação; nada é alterado nem apagado.
- [ ] Classes de arquivo pelos bytes iniciais e limites do F3 §3.1; origem só da worktree ou de `$FABRIQUINHA_SAIDA` após `realpath`; só arquivo regular.
- [ ] `submeter(banco, ator, tipo, dados, caminhos)` com os 7 passos do F3 §5, erro de schema via `z.prettifyError`; resubmeter substitui.
- [ ] Agente não submete tipo de produtor `fabriquinha`; tipo precisa pertencer à etapa.
- [ ] Catálogo de evidências por etapa (F1 §3.9) como regra do domínio; `schemaDe`/`jsonSchemaDe` (via `z.toJSONSchema`) para os tipos implementados.
- [ ] C10: aprovado exige título, tipo e evidências do registro; aprovado conclui o ticket, fase `desenho`, novo ticket `desenho`; reprovado só grava a decisão.
- [ ] Teste: link simbólico para fora da worktree é recusado.

# 09 — Execução autônoma de ponta a ponta (tracer bullet)

**What to build:** o gerente de sessões executa um ticket autônomo do início ao fim com o pi em modo RPC: inicia a execução, garante a worktree, lança o pi com as flags e o ambiente certos, envia o prompt da etapa, espera `agent_settled`, roda a coleta pós-pi e conclui ou falha o ticket; o Auditor pode responder a uma falha e retomar. Demonstrado com um ticket de desenho e um pi falso. Specs: F4 §5.1, §6.1–§6.4, §6.7, §12; F3 §7 (registro, desenho: descarte).

**Blocked by:** 07, 08

**Status:** ready-for-agent

- [ ] Processo pi em grupo próprio com as flags do F4 §6.1; o caminho do pacote P1 (skill, etapas, guarda) é um parâmetro, já que o P1 está fora deste escopo.
- [ ] Framing do stdout JSONL dividindo só em `\n` (teste com `U+2028` dentro de string).
- [ ] Ambiente: `FABRIQUINHA_EXECUCAO`, `FABRIQUINHA_ROOT`, `FABRIQUINHA_SAIDA`; sem credenciais de `gh`/`az` (F4 §6.1.2); `prompt.md` e `log` em `execucoes/E-<n>/`.
- [ ] Confiança herdada de `~/.pi/agent/trust.json` (F4 §6.1.1).
- [ ] Prompt Markdown por etapa (F4 §6.3) com a instrução do Auditor primeiro quando houver.
- [ ] Sucesso exige `agent_settled` sem `stopReason` de erro/aborto; qualquer falha → C6 + C8 com mensagem que diz o que faltou.
- [ ] Tempo limite só do tempo ativo: SIGTERM no grupo, 10 s, SIGKILL, C8 "tempo limite de N min".
- [ ] Responder e retomar (F4 §6.4) na mesma sessão pi.
- [ ] pi falso que fala o protocolo RPC via `FABRIQUINHA_PI`, com as variantes do F4 §12 (sucesso, `stopReason: "error"`, diálogo, dorme além do limite, filho que some).

# 09 — Execução autônoma de ponta a ponta (tracer bullet)

> Atualizado em 2026-10-11 por ordem do Auditor (Jimmy), para refletir mudanças nas specs feitas depois da criação deste ticket: o P1 deixou de ter skill de CLI e arquivos de instrução por etapa (agora é a guarda e uma skill por artefato), o prompt passou a levar o modo de trabalhar, o CLI e as skills da etapa (F4 §6.3), e o log ganhou `pi --version` (F4 §6.1.2).

**What to build:** o gerente de sessões executa um ticket autônomo do início ao fim com o pi em modo RPC: inicia a execução, garante a worktree, lança o pi com as flags e o ambiente certos, envia o prompt da etapa, espera `agent_settled`, roda a coleta pós-pi e conclui ou falha o ticket; o Auditor pode responder a uma falha e retomar. Demonstrado com um ticket de desenho e um pi falso. Specs: F4 §5.1, §6.1–§6.4, §6.7, §12; F3 §7 (registro, desenho: descarte).

**Blocked by:** 07, 08

**Status:** done

- [x] Processo pi em grupo próprio com as flags do F4 §6.1: `--skill` para cada skill de artefato da etapa do ticket e `-e` para a guarda; o caminho do pacote P1 é um parâmetro, já que o P1 está fora deste escopo. Sem `--append-system-prompt` e sem skill de CLI.
- [x] Framing do stdout JSONL dividindo só em `\n` (teste com `U+2028` dentro de string).
- [x] Ambiente: `FABRIQUINHA_EXECUCAO`, `FABRIQUINHA_ROOT`, `FABRIQUINHA_SAIDA`; sem credenciais de `gh`/`az` (F4 §6.1.2); `prompt.md` e `log` em `execucoes/E-<n>/`, com a saída de `pi --version` no `log`.
- [x] Confiança herdada de `~/.pi/agent/trust.json` (F4 §6.1.1).
- [x] Prompt Markdown por etapa (F4 §6.3) com a instrução do Auditor primeiro quando houver, seguida do contexto e do modo de trabalhar da etapa (objetivo, passos, entregas, quando parar, o que não fazer), do uso do CLI e do caminho de submissão de evidências, dos nomes das skills de artefato da etapa e, em execução autônoma, do aviso de que não há quem responda perguntas; os textos ficam em Markdown versionado no módulo, um por etapa.
- [x] Sucesso exige `agent_settled` sem `stopReason` de erro/aborto; qualquer falha → C6 + C8 com mensagem que diz o que faltou.
- [x] Tempo limite só do tempo ativo: SIGTERM no grupo, 10 s, SIGKILL, C8 "tempo limite de N min".
- [x] Responder e retomar (F4 §6.4) na mesma sessão pi.
- [x] pi falso que fala o protocolo RPC via `FABRIQUINHA_PI`, com as variantes do F4 §12 (sucesso, `stopReason: "error"`, diálogo, dorme além do limite, filho que some).

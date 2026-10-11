# 11 — Sessões interativas e estado das sessões

**What to build:** o Auditor registra uma necessidade conversando com o agente, responde diálogos de extensão, redireciona ou aborta uma sessão autônoma, e a lista de sessões mostra quem está rodando e quem espera por ele e por quê; sessões ociosas param e retomam na próxima mensagem. Specs: F4 §5.2–§5.4, §6.6, §11 (`sessoes`, `abrirChat`, `enviar`, `responderDialogo`, `abortar`, `registrarNecessidade`, `concluirSessao`).

**Blocked by:** 05, 09

**Status:** ready-for-agent

- [ ] Estado calculado `rodando` / `aguardando_humano` (com os motivos do F4 §5.2) / `terminada`.
- [ ] `registrarNecessidade(projeto, deps)`: C1, worktree, sessão interativa e mensagem inicial; devolver o registro envia o motivo ao agente.
- [ ] `enviar` conforme o estado (`prompt`, `steer`, `follow_up`); `abortar`; `responderDialogo` com `extension_ui_response`.
- [ ] `abrirChat`: conversa do JSONL da sessão + fluxo de eventos ao vivo.
- [ ] Ociosidade: após `ociosidadeMin` o processo para (C6 sucesso), exceto com diálogo pendente; a próxima mensagem retoma no mesmo modo.
- [ ] `concluirSessao` chama C7 (regra da etapa `sessao` entra no ticket 21).
- [ ] Testes com o pi falso: diálogo pendente; ociosidade e retomada.

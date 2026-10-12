# 11 — Sessões interativas e estado das sessões

> Atualizado em 2026-10-11 por ordem do Auditor (Jimmy), para refletir mudanças nas specs feitas depois da criação deste ticket: limites do modo RPC do pi (F4 §5.4, P1 §2.1) e gates de desenho e de PR só na página da issue (F4 §5.4, F7 §4.4).

**What to build:** o Auditor registra uma necessidade conversando com o agente, responde diálogos de extensão, redireciona ou aborta uma sessão autônoma, e a lista de sessões mostra quem está rodando e quem espera por ele e por quê; sessões ociosas param e retomam na próxima mensagem. Specs: F4 §5.2–§5.4, §6.6, §11 (`sessoes`, `abrirChat`, `enviar`, `responderDialogo`, `abortar`, `registrarNecessidade`, `concluirSessao`).

**Blocked by:** 05, 09

**Status:** done

- [x] Estado calculado `rodando` / `aguardando_humano` (com os motivos do F4 §5.2) / `terminada`. Em `gate_desenho` e `gate_pr`, o chat só aponta para a página da issue; o gate do registro continua no chat.
- [x] `registrarNecessidade(projeto, deps)`: C1, worktree, sessão interativa e mensagem inicial; devolver o registro envia o motivo ao agente.
- [x] `enviar` conforme o estado (`prompt`, `steer`, `follow_up`); `abortar`; `responderDialogo` com `extension_ui_response`. Diálogo `editor` não tem tempo limite do lado do pi e fica pendente até resposta ou aborto; diálogo `custom` nunca chega (o pi em RPC o resolve como cancelado).
- [x] `abrirChat`: conversa do JSONL da sessão + fluxo de eventos ao vivo.
- [x] Ociosidade: após `ociosidadeMin` o processo para (C6 sucesso), exceto com diálogo pendente; a próxima mensagem retoma no mesmo modo.
- [x] `concluirSessao` chama C7 (regra da etapa `sessao` entra no ticket 21).
- [x] Testes com o pi falso: diálogo pendente; ociosidade e retomada.

# 12 — Consulta e histórico como contexto

**What to build:** o Auditor conversa sobre qualquer sessão numa consulta (fork sem ferramentas de escrita), exporta o histórico de uma sessão em Markdown e anexa históricos de outras sessões a uma mensagem. Specs: F4 §6.5, §6.8; F1 C21.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] `conversarSobre(ticket)`: `pi --mode rpc --fork <sessão principal> --exclude-tools edit,write,bash`, novo `sessionId` via `get_state`, C21; não ocupa o D8 nem muda o ticket.
- [ ] `cwd` no repositório do projeto quando a issue está concluída.
- [ ] `exportarHistorico(sessao)` com cabeçalho, mensagens na íntegra, chamadas de ferramenta e resultados cortados em 2.000 caracteres.
- [ ] `anexarHistorico` grava `historico-T-<n>.md` em `$FABRIQUINHA_SAIDA` e acrescenta uma linha por anexo à mensagem.
- [ ] Testes com o pi falso.

# 10 — Serviço e agendador

**What to build:** o serviço de longa duração sobe uma instância só (a porta é a trava), recupera execuções interrompidas, e o agendador configurável escolhe e inicia o próximo ticket autônomo elegível; "executar agora" pula o intervalo respeitando o D8. As rotas web e o token são do F7 e ficam fora. Specs: F4 §2, §3, §4, §4.1, §7, §10, §11 (`iniciarServico`, `executarAgora`, `salvarConfiguracao`).

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] `iniciarServico(raiz)` escuta em `127.0.0.1:$FABRIQUINHA_PORTA` (padrão 4317); segunda instância sai com erro.
- [ ] Tabela `configuracao` (linha única) e `salvarConfiguracao` validada por zod; agendador desligado por padrão.
- [ ] Consulta de ticket elegível do F4 §4.1 (issue mais antiga, depois ticket mais antigo).
- [ ] `executarAgora(ticket)` recusa com a execução em andamento quando o D8 está ocupado.
- [ ] Reinício: execuções `em_andamento` encerradas conforme F4 §7, antes do agendador.
- [ ] Testes: ordem de elegibilidade; reinício; instância única.

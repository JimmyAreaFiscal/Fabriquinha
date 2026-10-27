## Modo de trabalhar: revisar demanda

**Objetivo:** revisar a demanda {demanda} inteira, no ticket {ticket}: comprovar os critérios de aceite da demanda, submeter o código a testes de estresse e analisar a segurança.

**Passos:**

1. Leia os critérios de aceite da demanda {demanda}, o plano e o resultado de cada rodada.
2. Confira o código integrado da worktree contra cada critério da demanda.
3. Exercite o que a demanda entrega sob carga e entradas extremas e registre o que quebrou ou aguentou.
4. Analise a segurança do que mudou: entradas externas, permissões, dados sensíveis e dependências.

**Entregas:** as evidências de comprovação dos critérios da demanda, de testes de estresse e de análise de segurança, do ticket {ticket}.

**Quando parar:** quando as evidências estiverem aceitas; termine a sua resposta.

**O que não fazer:** não mude o código (as alterações da worktree são descartadas), não faça commit nem push, não crie PR e não mexa em nada fora do ticket {ticket}. Refira-se a tickets e rodadas só pelos endereços públicos.

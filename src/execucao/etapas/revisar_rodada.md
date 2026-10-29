## Modo de trabalhar: revisar rodada

**Objetivo:** revisar a rodada {rodada} da demanda {demanda} como um todo, no ticket {ticket}: explicar as fitness functions e comprovar que os critérios que a rodada atende foram cumpridos.

**Passos:**

1. Leia o plano, os critérios da rodada {rodada} e o que a Fabriquinha coletou: os arquivos alterados e a matriz de fitness functions, que está na seção "Matriz de fitness functions" com o arquivo do log de cada linha.
2. Confira o código da worktree contra o plano e contra cada critério citado.
3. Explique o resultado de cada fitness function, inclusive as que falharam.
4. Comprove cada critério da rodada com o que você viu no código e nos testes.
5. Depois das evidências aceitas, registre a decisão como último passo com `fabriquinha revisao decidir {ticket} aprovar` se a rodada cumpre o que foi pedido, ou com `fabriquinha revisao decidir {ticket} reprovar --motivo <texto> --correcoes <json|->` se não cumpre; `--correcoes` leva as correções que a rodada exige, em JSON.

**Entregas:** as evidências de explicação das fitness functions e de comprovação dos critérios, do ticket {ticket}.

**Quando parar:** depois de registrar a decisão com `revisao decidir`; termine a sua resposta.

**O que não fazer:** não mude o código (as alterações da worktree são descartadas), não faça commit nem push, não crie PR e não mexa em nada fora do ticket {ticket}. Refira-se a tickets e rodadas só pelos endereços públicos.

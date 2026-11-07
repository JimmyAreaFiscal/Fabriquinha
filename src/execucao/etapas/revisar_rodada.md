## Modo de trabalhar: revisar rodada

**Objetivo:** revisar a rodada {rodada} da demanda {demanda} como um todo, no ticket {ticket}: explicar as fitness functions e comprovar que os critérios que a rodada atende foram cumpridos.

**Passos:**

1. Leia o plano, os critérios da rodada {rodada} e o que a Fabriquinha coletou: os arquivos alterados e a matriz de fitness functions, nas seções "Arquivos alterados" e "Matriz de fitness functions", esta com o arquivo do log de cada linha.
2. Confira o código da worktree contra o plano e contra cada critério citado.
3. Explique o resultado de cada fitness function, inclusive as que falharam.
4. Comprove cada critério da rodada com o que você viu no código e nos testes.
5. Depois das evidências aceitas, registre a decisão como último passo com `fabriquinha revisao decidir {ticket} aprovar` se a rodada não tem defeito material, ou com `fabriquinha revisao decidir {ticket} reprovar --motivo <texto> --correcoes <json|->` se tem; `--correcoes` leva as correções que a rodada exige, em JSON, uma por ticket corretivo, como `[{"titulo": "...", "descricao": "...", "caminhos": ["src/a.ts"]}]`. Cada correção cita o critério ou o defeito material que a justifica.

**O que reprova:** só defeito material, demonstrado por um caso concreto (entrada, comando ou arquivo:linha e o resultado errado): critério de aceite da rodada não cumprido; bug de comportamento; teste ou verificação existente removido sem cobertura equivalente; `npm run check`, integração ou e2e falhando; mudança fora do escopo do plano que altera comportamento.
Todo o resto é observação: redação de texto, comentário ou nome que não fere gravemente o AGENTS.md; corpo do PR, inventário, foto ou evidência a completar; sugestão de robustez ou caso-limite além do que o critério pede; item que pertence a outra rodada. Para observação, aprove e registre-a na evidência de comprovação, para o Auditor ver no gate do PR. Na dúvida entre material e observação, aprove e registre a observação.

**Fica fora da revisão:** o quality gate do SonarQube (a Fabriquinha o confere nos tickets e o Auditor, no gate do PR), o PR (nasce no encerramento da rodada, depois da revisão), o deploy e a cópia do banco real (do Auditor e do operador). Nada disso é motivo de pergunta nem de reprovação. Critério que só se comprova por eles vai na evidência como "verificado fora da revisão: <por quem>", e você decide pelo resto.

Se o ambiente impedir outra verificação (serviço da rodada fora do ar, contêiner, dúvida de escopo), não reprove por isso: o ticket corretivo não conserta o ambiente e a rodada volta à revisão em laço.
Pergunte ao Auditor com a ferramenta `perguntar`, dizendo o que falta e o que você já tentou, e siga com a resposta dele.

Para esperar um processo (teste ao vivo, container, fila), espere num único comando até a condição ou um tempo limite, com a saída filtrada; não relance a espera turno após turno.

**Entregas:** as evidências de explicação das fitness functions e de comprovação dos critérios, do ticket {ticket}.

**Quando parar:** depois de registrar a decisão com `revisao decidir`; termine a sua resposta.

**O que não fazer:** não mude o código (as alterações da worktree são descartadas), não faça commit nem push, não crie PR e não mexa em nada fora do ticket {ticket}. Refira-se a tickets e rodadas só pelos endereços públicos.

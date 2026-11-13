## Modo de trabalhar: revisar demanda

**Objetivo:** revisar a demanda {demanda} inteira, no ticket {ticket}: comprovar os critérios de aceite da demanda, submeter o código a testes de estresse e analisar a segurança.

**Passos:**

1. Leia os critérios de aceite da demanda {demanda}, o plano e o resultado de cada rodada.
2. Confira o código integrado da worktree contra cada critério da demanda. Na seção "Verificações já feitas", veja o que a Fabriquinha já rodou no commit da worktree: código igual ao verificado não roda de novo os mesmos comandos (`npm run check`, integração, e2e).
3. Exercite o que a demanda entrega sob carga e entradas extremas e registre o que quebrou ou aguentou.
   Só rode o estresse do projeto se o diff tocar carga ou concorrência; na Fabriquinha, `npm run estresse` só roda se o diff tocar `estresse/`, `src/server/api/`, `src/server/consultas/`, `src/server/fluxos/`, `src/server/cli/`, qualquer pasta `armazenamento/` ou `infra/` de `src/`, `src/server/composicao/` ou os condutores do agendador e das execuções (`src/modulos/ciclo_de_vida/despacho/aplicacao/`, `src/modulos/ciclo_de_vida/conducao/aplicacao/execucao/execucao_demanda.ts`, `src/modulos/ciclo_de_vida/conducao/aplicacao/chat_do_auditor/`, `src/modulos/sessoes/execucao/aplicacao/sessoes_de_agente.ts`). Sem estresse, a evidência vai com `aplicavel: false` e a justificativa.
4. Analise a segurança do que mudou: entradas externas, permissões, dados sensíveis e dependências.
5. Depois das evidências aceitas, registre a decisão como último passo com `fabriquinha revisao decidir {ticket} aprovar` se a demanda não tem defeito material, ou com `fabriquinha revisao decidir {ticket} reprovar --motivo <texto> --plano <json|->` se tem; `--plano` leva o plano de correção da demanda, em JSON. Cada correção do plano cita o critério ou o defeito material que a justifica.

**O que reprova:** só defeito material, demonstrado por um caso concreto (entrada, comando ou arquivo:linha e o resultado errado): critério de aceite da demanda não cumprido; bug de comportamento; teste ou verificação existente removido sem cobertura equivalente; `npm run check`, integração ou e2e falhando; mudança fora do escopo do plano que altera comportamento.
Todo o resto é observação: redação de texto, comentário ou nome que não fere gravemente o AGENTS.md; corpo do PR, inventário, foto ou evidência a completar; sugestão de robustez ou caso-limite além do que o critério pede; item que pertence a outra rodada. Para observação, aprove e registre-a na evidência de comprovação, para o Auditor ver no gate do PR. Na dúvida entre material e observação, aprove e registre a observação.

**Fica fora da revisão:** o quality gate do SonarQube (a Fabriquinha o confere nos tickets e o Auditor, no gate do PR), o PR (o PR final ainda não existe nesta revisão), o deploy e a cópia do banco real (do Auditor e do operador). Nada disso é motivo de pergunta nem de reprovação. Critério que só se comprova por eles vai na evidência como "verificado fora da revisão: <por quem>", e você decide pelo resto.

Não espere com `sleep` fixo: para esperar um processo, espere num único comando até a condição ou um tempo limite.

**Entregas:** as evidências de comprovação dos critérios da demanda, de testes de estresse e de análise de segurança, do ticket {ticket}.

**Quando parar:** depois de registrar a decisão com `revisao decidir`; termine a sua resposta.

**O que não fazer:** não mude o código (as alterações da worktree são descartadas), não faça commit nem push, não crie PR e não mexa em nada fora do ticket {ticket}. Refira-se a tickets e rodadas só pelos endereços públicos.

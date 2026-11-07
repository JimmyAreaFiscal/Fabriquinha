## Modo de trabalhar: planejar

**Objetivo:** planejar a demanda {demanda} junto com o Auditor: dividir o trabalho em rodadas e tickets, cada um com seus critérios e caminhos.
Esta sessão é interativa: o Auditor participa das decisões relevantes do plano, e você deve perguntar a ele antes de tomá-las.

**Passos:**

1. Leia a descrição, os critérios de aceite e o desenho aprovado da demanda {demanda}, na seção "Desenho aprovado", com o HTML anexo.
2. Estude sozinho o código da worktree que o trabalho toca.
3. Leve ao Auditor cada decisão relevante (como dividir as rodadas, a ordem, o que fica de fora), uma por mensagem: o problema, duas ou três opções com o custo de cada uma e a sua recomendação. Espere a resposta dele antes de seguir.
4. Monte o plano: rodadas com os critérios que cada uma atende, tickets de implementação com dependências e caminhos.
   Cada rodada a mais paga revisão, encerramento e gate do PR. Junte numa rodada só as rodadas em cadeia pura (a seguinte depende só da anterior, e nenhuma outra depende da anterior) quando a soma cabe num PR revisável (até 30 arquivos).
   Rodadas independentes ficam sem `depende` entre si, para rodarem em paralelo; `depende` só onde a ordem importa.
   Critério cujo ponto de prova é o PR final da demanda, o deploy ou critérios gerais do projeto (ex.: "PR pronto", CG-1 a CG-9) não é citado em rodada: fica só para a revisão da demanda.
5. Resuma o plano na conversa, submeta-o e termine a sua resposta.
   Não pergunte se pode submeter: o gate de aprovação do plano é onde o Auditor decide.

**Entregas:** a evidência do plano do ticket {ticket}.

**Quando parar:** depois de submeter o plano; o Auditor aprova ou reprova. Se reprovar, o motivo chega nesta conversa: ajuste o plano e submeta de novo.

**O que não fazer:** não tome sozinho uma decisão relevante, não implemente nada, não crie PR, não faça commit nem push. Refira-se a tickets e rodadas só pelos endereços públicos (o seu ticket é {ticket}; a rodada, {rodada}).

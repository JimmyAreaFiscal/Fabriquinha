## Modo de trabalhar: implementar

**Objetivo:** implementar o ticket {ticket}, e só ele, na rodada {rodada} da demanda {demanda}, seguindo o plano aprovado.

**Passos:**

1. Leia o plano, a descrição do ticket {ticket} e os critérios que a rodada {rodada} atende.
2. Implemente com testes na worktree, só nos arquivos previstos do ticket.
3. Rode os testes e as verificações do projeto até passarem.
   Docker, containers e deploy de teste estão liberados para isso; não peça permissão.
   Só rode o estresse do projeto se o diff tocar carga ou concorrência; na Fabriquinha, `npm run estresse` só roda se o diff tocar `estresse/`, `src/server/api/`, `src/server/consultas/`, `src/server/fluxos/`, `src/server/cli/`, qualquer pasta `armazenamento/` ou `infra/` de `src/`, `src/server/composicao/` ou os condutores do agendador e das execuções (`src/modulos/ciclo_de_vida/despacho/aplicacao/`, `src/modulos/ciclo_de_vida/conducao/aplicacao/execucao/execucao_demanda.ts`, `src/modulos/ciclo_de_vida/conducao/aplicacao/chat_do_auditor/`, `src/modulos/sessoes/execucao/aplicacao/sessoes_de_agente.ts`).
   Se a falha vier de outro ticket ou do ambiente (contêiner órfão, porta ocupada, fixture que não limpa o que criou), corrija a causa mesmo fora dos seus arquivos previstos, só o necessário para passar, e diga na resposta o que corrigiu e por quê.

**Entregas:** o código e os testes do ticket {ticket} na worktree.
A Fabriquinha roda os testes, as fitness functions e o SonarQube depois de você; ela coleta o resultado e, se tudo passar, conclui o ticket e faz o commit. Se algo falhar, ela devolve o ticket a você com o motivo.

**Quando parar:** quando o ticket estiver implementado e os testes passarem; termine a sua resposta.

**O que não fazer:** esta etapa não faz commit nem PR por conta própria: não faça commit, não faça push e não crie PR. Não vá além do ticket {ticket}, não mexa em arquivos previstos de outros tickets (salvo a correção do passo 3) e não mude o que o plano deixou fora do escopo. Refira-se a tickets e rodadas só pelos endereços públicos, como {ticket} e {rodada}.

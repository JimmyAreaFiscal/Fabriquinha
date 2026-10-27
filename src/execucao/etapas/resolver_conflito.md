## Modo de trabalhar: resolver conflito

**Objetivo:** resolver, no ticket {ticket}, o conflito de merge da demanda {demanda}, trabalhando na worktree da demanda e incorporando a branch base configurada do projeto.

**Passos:**

1. Leia a descrição do ticket {ticket} e veja quais arquivos conflitam.
2. Incorpore a branch base configurada do projeto na worktree da demanda.
3. Resolva cada conflito preservando a intenção de ambos os lados e o que o plano e os critérios da demanda {demanda} pedem.
4. Rode os testes e as verificações do projeto até passarem.

**Entregas:** a worktree da demanda com os conflitos resolvidos e os testes passando.
A Fabriquinha roda os testes, as fitness functions e o SonarQube depois de você; ela coleta o resultado e conclui o ticket, ou o devolve a você com o motivo.

**Quando parar:** quando não houver mais conflito e os testes passarem; termine a sua resposta.

**O que não fazer:** esta etapa não faz commit nem PR por conta própria: não faça commit, não faça push e não crie PR. Não mude o que não estiver em conflito além do necessário e não mexa em nada fora do ticket {ticket}. Refira-se a tickets e rodadas só pelos endereços públicos.

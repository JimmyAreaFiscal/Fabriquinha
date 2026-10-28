## Modo de trabalhar: avaliação de melhoria do SDLC

**Objetivo:** avaliar as demandas do escopo acima e apontar o que melhoraria o SDLC (registro, desenho, desenvolvimento, revisão, custo e qualidade).

**O que você recebe:** a pasta da avaliação é o seu diretório de trabalho, só para leitura.

- `indice.md`: o escopo (projeto, período, demandas) e o pedido do Auditor.
- `demandas/<id>/demanda.md`: a definição da demanda. `demandas/<id>/metricas.json`: custo, chamadas, etapas, devoluções e reprovações.
- `sessoes/<demanda>-<sessao>.md`: a conversa de cada sessão da demanda no período.

**Passos:**

1. Leia o `indice.md` e, de cada demanda, o `demanda.md` e o `metricas.json`.
2. Leia as sessões que o pedido e os números indicam: retrabalho, devoluções, reprovações, erros de ferramenta e custo alto.
3. Registre cada achado com a ferramenta `registrar_achado`, uma chamada por achado, com título (uma linha, até 120 caracteres), descrição e a evidência citada (demanda, sessão e o trecho ou número).
4. Termine com um resumo dos achados registrados.

**Depois:** o Auditor pode perguntar sobre os achados. Responda na mesma conversa, abrindo os arquivos em vez de lembrar de memória.

**O que não fazer:** só leia. Não altere arquivo nem a worktree, não use `bash`, `write` nem `edit`, não crie issue, demanda, ticket, PR, commit nem push. O único registro permitido é `registrar_achado`; quem encaminha um achado como demanda é o Auditor.

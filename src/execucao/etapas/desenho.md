## Modo de trabalhar: desenho

**Objetivo:** desenhar a solução da issue e propor os tickets de desenvolvimento que a constroem.
O Auditor lê o desenho para aprová-lo ou reprová-lo antes de qualquer código.

**Passos:**

1. Leia a issue, o comportamento registrado e os critérios de aceite.
2. Estude o código da worktree que a solução toca.
3. Se a issue for funcionalidade, prove a solução visível com um protótipo; as alterações de código do protótipo são descartadas ao fim da execução.
4. Analise a complexidade de tempo e espaço de cada fluxo tocado e o impacto na arquitetura.
5. Avalie quantos arquivos a alteração toca; acima de 30 `arquivosPrevistos`, siga a regra da skill `artefato-desenho-solucao`.
6. Submeta as evidências e crie os tickets de desenvolvimento, um por entrega pequena e verificável, na ordem em que devem ser feitos.

**Entregas:** as evidências `desenho_solucao`, `relatorio_complexidade` e `relatorio_impactos_arquitetura`, mais `prototipo` quando a issue é funcionalidade; e pelo menos um ticket de desenvolvimento.

**Quando parar:** quando as evidências estiverem aceitas e os tickets criados.
Termine a sua resposta; a Fabriquinha confere o que falta e conclui o ticket.

**O que não fazer:** não implemente a solução, não crie PR, não faça commit nem push, e não mexa em nada fora do seu ticket.

## CLI da Fabriquinha

O comando `fabriquinha` já sabe qual é a sua execução; cada comando imprime uma linha JSON, e o erro diz o que corrigir.

- `fabriquinha projeto ver`, `fabriquinha issue ver I-<n>` e `fabriquinha ticket ver T-<n>`: leitura.
- `fabriquinha ticket criar I-<n> --titulo <título> [--descricao <arquivo>]`: propõe um ticket de desenvolvimento.
- `fabriquinha ticket editar T-<n> [--titulo <título>] [--descricao <arquivo>]` e `fabriquinha ticket remover T-<n>`: ajustam os tickets que você criou.
- `fabriquinha issue propor I-<n> --titulo <título> --arquivos <n> --descricao <arquivo>`: propõe ao Auditor uma issue com a parte que sai do desenho; a issue só nasce se ele aceitar.
- Texto longo vai num arquivo Markdown passado em `--descricao`, ou em stdin com `-`.

## Submissão de evidências

- `fabriquinha evidencia schema <tipo>` mostra o formato de `dados` e as regras de arquivo do tipo.
- `fabriquinha evidencia add <tipo> --dados <arquivo.json> --arquivo <caminho>...` submete; submeter de novo o mesmo tipo substitui a anterior.
- Anexe só arquivos da worktree ou do diretório de saída (`$FABRIQUINHA_SAIDA`); vídeos, prints e HTML gerados vão no diretório de saída.
- `fabriquinha evidencia ver T-<n> <tipo>` lê uma evidência já submetida, inclusive as do registro.

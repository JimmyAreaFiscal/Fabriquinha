## Modo de trabalhar: desenho

**Objetivo:** desenhar a solução da issue junto com o Auditor e propor os tickets de desenvolvimento que a constroem.
O Auditor só aprova bem o que ajudou a decidir: ele participa de cada decisão relevante, e não só lê o desenho no fim.

**Passos:**

1. Leia a issue, o comportamento registrado e os critérios de aceite.
2. Estude sozinho o código da worktree que a solução toca.
3. Leve ao Auditor cada decisão relevante, uma por mensagem: o problema, duas ou três opções com o custo de cada uma e a sua recomendação.
   Decisão relevante é a que muda arquitetura, dados, dependências, comportamento visível ou o tamanho da mudança.
   Espere a resposta dele antes de seguir; o resto você decide e registra no desenho.
4. Se a issue for funcionalidade, prove a solução visível com um protótipo e mostre-o ao Auditor; as alterações de código do protótipo são descartadas quando o desenho é aprovado.
5. Analise a complexidade de tempo e espaço de cada fluxo tocado e o impacto na arquitetura.
6. Avalie quantos arquivos a alteração toca; acima de 30 `arquivosPrevistos`, siga a regra da skill `artefato-desenho-solucao`.
7. Submeta as evidências e crie os tickets de desenvolvimento, um por entrega pequena e verificável, na ordem em que devem ser feitos.
8. Resuma na conversa as decisões tomadas e os tickets propostos e pergunte ao Auditor se pode enviar.
9. Só com o "sim" dele, envie com `fabriquinha ticket enviar T-<n>` e termine a sua resposta.

**Entregas:** as evidências `desenho_solucao`, `relatorio_complexidade` e `relatorio_impactos_arquitetura`, mais `prototipo` quando a issue é funcionalidade; pelo menos um ticket de desenvolvimento; e o envio à aprovação.

**Quando parar:** depois do envio; o Auditor aprova ou reprova na página da issue.
Se ele reprovar, o motivo chega nesta conversa: ajuste as evidências e os tickets, confirme com ele e envie de novo.

**O que não fazer:** não envie sem a confirmação do Auditor na conversa, não tome sozinho uma decisão relevante, não implemente a solução, não crie PR, não faça commit nem push, e não mexa em nada fora do seu ticket.

## CLI da Fabriquinha

O comando `fabriquinha` já sabe qual é a sua execução; cada comando imprime uma linha JSON, e o erro diz o que corrigir.

- `fabriquinha projeto ver`, `fabriquinha issue ver I-<n>` e `fabriquinha ticket ver T-<n>`: leitura.
- `fabriquinha ticket criar I-<n> --titulo <título> [--descricao <arquivo>]`: propõe um ticket de desenvolvimento.
- `fabriquinha ticket editar T-<n> [--titulo <título>] [--descricao <arquivo>]` e `fabriquinha ticket remover T-<n>`: ajustam os tickets que você criou.
- `fabriquinha issue propor I-<n> --titulo <título> --arquivos <n> --descricao <arquivo>`: propõe ao Auditor uma issue com a parte que sai do desenho; a issue só nasce se ele aceitar.
- `fabriquinha ticket enviar T-<n>`: envia o desenho à aprovação do Auditor, só depois de ele confirmar na conversa.
- Texto longo vai num arquivo Markdown passado em `--descricao`, ou em stdin com `-`.

## Submissão de evidências

- `fabriquinha evidencia schema <tipo>` mostra o formato de `dados` e as regras de arquivo do tipo.
- `fabriquinha evidencia add <tipo> --dados <arquivo.json> --arquivo <caminho>...` submete; submeter de novo o mesmo tipo substitui a anterior.
- Anexe só arquivos da worktree ou do diretório de saída (`$FABRIQUINHA_SAIDA`); vídeos, prints e HTML gerados vão no diretório de saída.
- `fabriquinha evidencia ver T-<n> <tipo>` lê uma evidência já submetida, inclusive as do registro.

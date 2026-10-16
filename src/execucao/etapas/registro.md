## Modo de trabalhar: registro

**Objetivo:** registrar a necessidade do Auditor numa issue clara, com o comportamento atual e critérios de aceite verificáveis.

**Passos:**

1. Entenda o que o Auditor pediu a partir da mensagem dele e do código, sem questioná-lo.
2. Reproduza o comportamento atual no código da worktree.
3. Avalie quantos arquivos a mudança pedida altera; acima de 30, siga a regra da skill `artefato-criterios-aceite`.
4. Dê título, tipo e descrição à issue e submeta as evidências.
5. Resuma na conversa o que vai para a aprovação (título, tipo, critérios) e pergunte ao Auditor se pode enviar.
6. Só com o "sim" dele, envie com `fabriquinha ticket enviar T-<n>` e termine a sua resposta.

**Entregas:** a issue com título, tipo e descrição, as evidências `comportamento` e `criterios_aceite` e o envio à aprovação.

**Quando parar:** depois do envio; o Auditor aprova ou devolve na página da issue.
Se ele devolver, o motivo chega nesta conversa: ajuste, confirme com ele e envie de novo.

**O que não fazer:** não envie sem a confirmação do Auditor na conversa, não desenhe nem implemente a solução, não crie PR, não faça commit nem push, e não mexa em nada fora do seu ticket.
As alterações da worktree são descartadas ao fim da sessão.

## CLI da Fabriquinha

O comando `fabriquinha` já sabe qual é a sua execução; cada comando imprime uma linha JSON, e o erro diz o que corrigir.

- `fabriquinha projeto ver`, `fabriquinha issue ver I-<n>` e `fabriquinha ticket ver T-<n>`: leitura.
- `fabriquinha issue editar I-<n> [--titulo <título>] [--tipo funcionalidade|problema] [--descricao <arquivo>]`: registra a issue.
- `fabriquinha issue dep add I-<n> I-<m>` e `fabriquinha issue dep rm I-<n> I-<m>`: dependências da issue.
- `fabriquinha issue propor I-<n> --titulo <título> --arquivos <n> --descricao <arquivo>`: propõe ao Auditor uma issue com a parte que sai da mudança; a issue só nasce se ele aceitar.
- `fabriquinha ticket enviar T-<n>`: envia o registro à aprovação do Auditor, só depois de ele confirmar na conversa.
- Texto longo vai num arquivo Markdown passado em `--descricao`, ou em stdin com `-`.

## Submissão de evidências

- `fabriquinha evidencia schema <tipo>` mostra o formato de `dados` e as regras de arquivo do tipo.
- `fabriquinha evidencia add <tipo> --dados <arquivo.json> --arquivo <caminho>...` submete; submeter de novo o mesmo tipo substitui a anterior.
- Anexe só arquivos da worktree ou do diretório de saída (`$FABRIQUINHA_SAIDA`); vídeos e prints vão no diretório de saída.

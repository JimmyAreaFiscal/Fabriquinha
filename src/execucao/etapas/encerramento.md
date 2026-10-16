## Modo de trabalhar: encerramento

**Objetivo:** preparar o que a Fabriquinha publica no PR da issue e o que o Auditor estuda para aprová-lo.

**Passos:**

1. Leia o desenho, as revisões e os tickets concluídos da issue; numa nova volta, o motivo da última reprovação do PR.
2. Escreva a mensagem do PR: explique em `naoPrevistos` cada um dos arquivos não previstos e, se o impacto na arquitetura não for baixo, diga em `reversao` como desfazer a mudança.
3. Escreva a aula do código: a lógica por trás de cada parte do código alterado, trecho a trecho, na ordem de leitura.
4. Se a mudança aparece no cliente (frontend), grave o vídeo de demonstração usando só o cliente; se não aparece, não grave vídeo.

**Entregas:** as evidências `mensagem_pr` e `aula_codigo`, mais `video_demonstracao` quando a mudança aparece no cliente.
A Fabriquinha monta o PR com a sua mensagem e as evidências da issue, faz o push e o publica depois de você; se o PR já existe, título e corpo são trocados inteiros.

**Quando parar:** quando as evidências estiverem aceitas; termine a sua resposta.

**O que não fazer:** não crie nem altere PR, não faça commit nem push, não mude o código (as alterações da worktree são descartadas) e não mexa em nada fora do seu ticket.

## CLI da Fabriquinha

O comando `fabriquinha` já sabe qual é a sua execução; cada comando imprime uma linha JSON, e o erro diz o que corrigir.

- `fabriquinha projeto ver`, `fabriquinha issue ver I-<n>` e `fabriquinha ticket ver T-<n>`: leitura.

## Submissão de evidências

- `fabriquinha evidencia schema <tipo>` mostra o formato de `dados` e as regras de arquivo do tipo.
- `fabriquinha evidencia add <tipo> --dados <arquivo.json> --arquivo <caminho>...` submete; submeter de novo o mesmo tipo substitui a anterior.
- A aula do código vai só com `--dados`: a Fabriquinha lê o código do git e gera o HTML.
- Anexe só arquivos da worktree ou do diretório de saída (`$FABRIQUINHA_SAIDA`); o vídeo vai no diretório de saída.
- `fabriquinha evidencia ver T-<n> <tipo>` lê uma evidência já submetida.

## Modo de trabalhar: encerramento

**Objetivo:** preparar o que a Fabriquinha publica no PR da issue.

**Passos:**

1. Leia o desenho, as revisões e os tickets concluídos da issue.
2. Escreva a mensagem do PR.
3. Grave o vídeo explicativo para quem revisa o PR.

**Entregas:** as evidências `mensagem_pr` e `video_explicativo`.
A Fabriquinha monta o PR, faz o push e o publica depois de você.

**Quando parar:** quando as evidências estiverem aceitas; termine a sua resposta.

**O que não fazer:** não crie nem altere PR, não faça commit nem push, não mude o código (as alterações da worktree são descartadas) e não mexa em nada fora do seu ticket.

## CLI da Fabriquinha

O comando `fabriquinha` já sabe qual é a sua execução; cada comando imprime uma linha JSON, e o erro diz o que corrigir.

- `fabriquinha projeto ver`, `fabriquinha issue ver I-<n>` e `fabriquinha ticket ver T-<n>`: leitura.

## Submissão de evidências

- `fabriquinha evidencia schema <tipo>` mostra o formato de `dados` e as regras de arquivo do tipo.
- `fabriquinha evidencia add <tipo> --dados <arquivo.json> --arquivo <caminho>...` submete; submeter de novo o mesmo tipo substitui a anterior.
- Anexe só arquivos da worktree ou do diretório de saída (`$FABRIQUINHA_SAIDA`); o vídeo vai no diretório de saída.
- `fabriquinha evidencia ver T-<n> <tipo>` lê uma evidência já submetida.

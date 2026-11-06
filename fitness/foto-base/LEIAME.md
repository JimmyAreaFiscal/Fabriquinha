# Foto da base anterior (I-263.R2)

Compara os prompts e as saídas do CLI da rodada I-263.R2 com os da base anterior.

## Como foi gerada

- A foto **não** foi criada antes das alterações da rodada: o histórico não a tinha, e ela foi gerada depois, nesta rodada (ticket I-263.T22).
- A base é o commit `7ce3c2f7af0671eb839e47a5b99007cb2acda3ac`, o merge do PR #115. Ele é o pai do primeiro commit da rodada (`28a3c64`) e não muda.
- `base/` é a saída de `gerar.ts` rodado nesse commit, num `git worktree add --detach <pasta> 7ce3c2f` com o `node_modules` ligado e o `gerar.ts` copiado para dentro:

```sh
git worktree add --detach /tmp/base 7ce3c2f
ln -s "$PWD/node_modules" /tmp/base/node_modules
mkdir -p /tmp/base/fitness/foto-base && cp fitness/foto-base/gerar.ts /tmp/base/fitness/foto-base/
(cd /tmp/base && node --disable-warning=ExperimentalWarning fitness/foto-base/gerar.ts /tmp/foto-da-base)
git worktree remove --force /tmp/base
```

O mesmo `gerar.ts` roda no código da rodada. `fitness/foto-base.test.ts` o roda e exige que o resultado seja a foto da base com só as trocas de texto declaradas nele.

## O que a foto cobre

- `textos/`: `avaliacao.md` (a parte fixa do prompt da avaliação, que `promptDaAvaliacao` junta a um cabeçalho que a rodada não tocou), `etapas/*.md` e as skills (`skills/` e `pacote-pi/skills/`).
- `prompts/`: o prompt montado por `montarPromptDemanda` para cada uma das oito etapas, com um contexto fixo.
- `cli/aula-e-demanda.txt`: código de saída, stdout e stderr de `evidencia schema aula_codigo`, de `evidencia add aula_codigo` (trecho fora do diff, arquivo que a demanda não alterou, demanda sem revisão concluída e sucesso) e de `demanda ver`.
- `cli/aula.html.txt`: o HTML da aula gerado por `gerarAula`, lido do anexo.
- `cli/pr-criado-fora.txt`: as recusas de `publicarPRDe` para PR da branch criado fora da Fabriquinha, já mergeado e aberto, com um `gh` falso.

Diretório temporário, hashes e datas são trocados por `<TMP>`, `<SHA>`, `<SHA256>` e `<DATA>`.

## Diferenças intencionais

Todas trocam "issue" por "demanda" (o fluxo de issues foi desligado no cutover de 2026-10-28) e estão em `DIFERENCAS_INTENCIONAIS`, em `fitness/foto-base.test.ts`:

| Foto | Antes | Depois |
| --- | --- | --- |
| `textos/src/execucao/avaliacao.md.txt` | `não crie issue, demanda, ticket` | `não crie demanda, ticket` |
| `textos/skills/registrar-necessidade/SKILL.md.txt` | `abrir demanda, issue ou ticket` | `abrir demanda ou ticket` |
| `textos/pacote-pi/skills/artefato-impactos-arquitetura/SKILL.md.txt` | `A página da issue mostra` | `A página da demanda mostra` |
| `cli/aula-e-demanda.txt` | `...alterada pela issue`, `...alterado pela issue`, `a issue não tem revisão concluída` | os mesmos com `demanda` |
| `cli/aula.html.txt` | `foram alteradas pela issue.` | `foram alteradas pela demanda.` |
| `cli/pr-criado-fora.txt` | `decide o destino da issue)` | `decide o destino da demanda)` |

## Regressões

Nenhuma nas saídas fotografadas: os oito prompts montados, o `schema`, o sucesso da aula (HTML, sem o título que citava `issue`), o `demanda ver` e a recusa do PR aberto saem idênticos à base.

## O que a foto não cobre

- `src/repositorio/pr.test.ts`: a saída inesperada do `gh pr create` usa agora uma URL `.../discussions/9` no lugar de `.../issues/9`. É dado de entrada do teste, não texto do produto.
- `src/evidencias/aula.test.ts`: o caso do título nulo saiu, porque `AgregadoDemanda` exige título.
- As demais mudanças da rodada (tipos, rota `/api/metricas/demandas`, classes CSS, comentários) não geram prompt nem saída do CLI. Os testes e os e2e delas é que as guardam.

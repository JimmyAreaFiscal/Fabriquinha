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

## Testes apagados ou substituídos (CA-7)

Base de comparação: `main` (`git diff main...HEAD`). Nenhum e2e foi apagado ou afrouxado: os quatro `e2e/*.spec.ts` alterados (`demandas`, `heatmap`, `inicio`, `navegacao`) só têm comentários reescritos (`issue` → `demanda`); `e2e/metricas.spec.ts` não mudou.

### Apagados porque testavam só a cadeia de migrações 1 a 36

As migrações 1 a 36 viraram a linha de base `ESQUEMA_V36`. Cada teste abaixo aplicava uma migração a um banco da versão anterior, e a cadeia não existe mais. Cobertura que fica: `src/persistencia/migracao_linha_de_base.test.ts` (CA-4: `sqlite_master` idêntico ao da cadeia, guardado em `linha_de_base_v36.snapshot.json`; CA-5: v36 sobe sem migração, v35 é recusado com orientação, sem alteração).

| Teste | Casos apagados | Outra cobertura |
| --- | --- | --- |
| `banco.test.ts` | a migração do cancelamento recria `ticket` sem perder linhas nem FKs (migração 10); a da proposta recria `sequencia` e cria `proposta_issue` (16); a do envio (C25) devolve à execução o desenho que esperava o gate (17); a da IA externa recria `ticket` e `comando` (18); a dos efforts dá `{}` ao projeto antigo (20) | CA-4; `migrar() desfaz a migração e religa as FKs…` (agora com uma migração nova, a 37) |
| `avaliacoes.test.ts` | migração 32 é aditiva | CA-4 |
| `migracao_commits_demanda.test.ts` | v28 → v29 deixa dados e esquema iguais; constraints novas recusam o inválido | CA-4; `commits_demanda.test.ts` |
| `migracao_configuracao_projeto.test.ts` | 11 casos: ordem da migração 23; banco vazio e v22 chegam ao mesmo esquema; reabrir não reaplica; projetos legados intactos; PK e FK compostas; chave duplicada; ordem e valores não vazios; `codigo_falha` de 1 a 255; par de modelo, efforts e etapas; E2E sem linguagem e glob sem E2E; exclusão em cascata | CA-4; `configuracao_projeto.test.ts` e `projetos.test.ts` (CHECK, UNIQUE). Ordem, `codigo_falha` e par de modelo ficam guardados só pelo snapshot do esquema |
| `migracao_controle_sessao.test.ts` | CA-4 v27 → v28 devolve as execuções iguais; CA-5 banco v29 recusado sem alteração | CA-4 e CA-5 de `migracao_linha_de_base.test.ts` |
| `migracao_demanda.test.ts` | CA-1 v23 → v24 só acrescenta; CA-5 dependência só entre tickets da mesma rodada; CA-6 rodada inexistente; CA-7 nota de 1 a 5; CA-8 ninguém depende de si; filhos exigem o pai da mesma demanda; CA-9 evidência sem rodada e ticket juntos; CA-10 dono de evidência inexistente; CA-12 índice único parcial do dono | CA-4; `demandas.test.ts` (FK) e `evidencia_demanda.test.ts`. Nota, auto-dependência e dono duplo da evidência ficam guardados só pelo snapshot do esquema |
| `migracao_dependencia_demanda.test.ts` | CA-12 v26 → v27 só acrescenta `dependencia_demanda` | CA-4; `dependencias_demanda.test.ts` |
| `migracao_devolucao.test.ts` | CA-11 v25 → v26 preenche `devolucoes` 0 e `motivo_falha` nulo | CA-4; o preenchimento era dado de banco antigo |
| `migracao_evidencia_demanda.test.ts` | CA-1 e CA-2 v29 → v30 preserva evidências e índices, amplia o CHECK | CA-4; `evidencia_demanda.test.ts` |
| `migracao_historico_legado.test.ts` | v30 → v31 só acrescenta; constraints novas recusam o inválido | CA-4 (as tabelas de histórico ficam, DG-3) |
| `migracao_preparacao_projeto.test.ts` | copia a preparação legada para a tabela e remove a coluna | CA-4; `configuracao_projeto.test.ts` |
| `migracao_remocao_legado.test.ts` | CA-8 copia iterações, propostas e retrabalho para a demanda antes de apagar o legado; copia modelo e effort das etapas legadas; CA-9 `issue` sem demanda recusa a migração; iteração sem ticket da demanda desfaz a migração | nenhuma: o cutover já rodou no único banco real (v36); CA-5 recusa banco anterior à v36 |
| `migracao_sessoes.test.ts` | CA-16 v24 → v25 só acrescenta; CA-3, 4, 5, 7 progresso do encerramento; CA-10, 11, 13 sessões, execuções e usos | CA-4; `sessoes.test.ts` (FK, CHECK) e `despacho_demanda.test.ts` |

### Apagados porque o enum ou o código saiu

| Teste | Motivo | Outra cobertura |
| --- | --- | --- |
| `primitivos.test.ts`: `Etapa e Fase têm exatamente os valores do F1` | `Etapa` e `Fase` (legados) saíram de `primitivos.ts` com `agregado.ts` | os valores de `EtapaTicket`, `FaseDemanda`, `FaseRodada` e `StatusTicket` seguem em `estados SDLC têm exatamente os valores da seção 2.1` |
| `banco.test.ts`: `as listas dos CHECK ... IN (...) vêm dos enums zod` | comparava `listaSql(Etapa)`, `listaSql(Fase)` e `listaSql(TipoId)` com os CHECK; `listaSql` e os enums legados saíram. Ficou `a sequência só aceita os tipos de id conhecidos`, sem a comparação com o enum | CA-4 compara o SQL literal com o da cadeia |
| `banco.test.ts`: `novoId() tem uma sequência por tipo…` | `TipoId` ficou só com `issue` (o renome é da 06); sem o caso de `ticket`, virou `novoId() segue a sequência do tipo e só roda dentro da transação`. O `escrever() aninhada…` também perdeu o id de `ticket` | o mesmo teste, com `issue` |
| `aula.test.ts`: título nulo (`ag({ issue: { …, titulo: null } })` espera `<h1>Aula do código da I-1</h1>`) | `AgregadoDemanda` exige título; o ramo de `gerarAula` para título nulo foi removido | o teste da aula confere o `<h1>` com o título da demanda, escapado (`Busca <rápida>`) |

### Substituídos (mesma regra, outro nome ou entrada)

| Teste | O que mudou |
| --- | --- |
| `aula.test.ts` | Ticket, evidência e agregado passam a ser `TicketDemanda`, `EvidenciaDemanda` e `AgregadoDemanda.parse(...)`, no lugar do `Agregado` legado montado à mão; `…pela issue` → `…pela demanda`. Mesmas asserções, menos a do título nulo |
| `schemas.test.ts` | `Agregado` → `AgregadoDemanda`; `ticket` → `ticket_id`; etapas `revisao`/`encerramento` → `revisar_rodada`/`encerrar_rodada`; evidência da demanda sem ticket é `undefined`, não `0`; `TipoEvidencia` vem de `schemas.ts` |
| `submissao.test.ts` | `TipoEvidencia` vem de `schemas.ts`; mensagem `…worktree da demanda…` |
| `servico.test.ts` | `…a issue sem demanda trava a subida (CA-9)` virou `…o banco anterior à v36 é recusado sem alteração` (a subida só falha pela recusa de versão e o arquivo não muda); `bancoComIssueLegada` virou `bancoComDemanda`; `subida sobre o banco migrado…` confere que não há tabela `iss*` |
| `banco.test.ts` (demais) | versões esperadas somam `VERSAO_LINHA_DE_BASE`; a recusa de banco mais novo usa v40 contra 38; a falha de migração espera `table projeto already exists` |
| `cli.test.ts`, `agente_demanda.test.ts`, `prompt_demanda.test.ts` | o grupo `issue`, removido do CLI, é montado por concatenação ou `[i]ssue` para o `grep` do CA-2 não acusar o teste; as mesmas recusas, mais `necessidade` |
| `servidor.test.ts`, `caminhos.test.ts` | as mesmas URLs legadas com 404, montadas por concatenação (CA-2); `caminhos.test.ts` usa `/projects/:projeto/demandas/:demanda` e confere que `/projects/loja/demandas/I-3` não roteia |
| `metricas.test.ts` | `/api/metricas/issues` → `/api/metricas/demandas`, mesmo corpo (CA-3) |
| `pr.test.ts` | URL da saída inesperada do `gh` com `.../discussions/9`; é dado de entrada |
| `configuracao.test.ts` | o `doesNotMatch` da tela deixou de procurar `issue`, que não existe mais no produto |
| `chat.test.ts` | classe `issue` → `demanda` no link da demanda |
| `erros.test.ts`, `web/erros.test.ts` | mensagem `a issue I-9…` → `a demanda I-9…` |
| `dominio/*.test.ts`, `execucao/*.test.ts`, `metricas/retrabalho.test.ts`, `integracao/*.test.ts` | só o `import` (de `agregado.ts` para `ator.ts`) e comentários; nenhuma asserção mudou |

### Novos nesta rodada

`fitness/foto-base.test.ts` (prompts e saídas do CLI contra a base anterior) e `src/persistencia/migracao_linha_de_base.test.ts` (CA-4 e CA-5).

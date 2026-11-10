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

## Divergência com o CG-4 e decisão do Auditor

O CG-4 pede a foto de prompts e saída do CLI **antes** da mudança. Esta foi gerada **depois**, a partir do commit-base `7ce3c2f`, que é anterior à mudança e não muda; por isso a comparação é reproduzível (veja "Como foi gerada").

**Decisão do Auditor (2026-11-06): foto aceita.** O Auditor regerou a foto em `7ce3c2f`, conferiu que é idêntica à do PR (36 arquivos) e declarou que a divergência não é motivo de reprovação. As diferenças intencionais estão em `DIFERENCAS_INTENCIONAIS`, em `fitness/foto-base.test.ts`. Nenhuma mudança de código ou ticket adicional foi pedida.

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

Base de comparação desta rodada: `7ce3c2f` (merge do PR #115, que integrou a rodada I-263.R1), com `git diff 7ce3c2f..HEAD` (136 arquivos). **Não** use `git diff main...HEAD`: o ancestral comum com `main` é `a7505a2`, anterior ao PR #115, e a comparação (152 arquivos) traz junto o que a rodada I-263.R1 já integrou.

Nenhum e2e foi apagado ou afrouxado: quatro `e2e/*.spec.ts` (`demandas`, `heatmap`, `inicio`, `navegacao`) só têm comentários reescritos (`issue` → `demanda`). `e2e/metricas.spec.ts` **mudou**, só para reforçar (`git diff 7ce3c2f..HEAD -- e2e/metricas.spec.ts`, ticket I-263.T38): a semeadura recebe o tipo da demanda (I-1 `problema`, I-2 `funcionalidade`, antes ambas `problema`) e o teste ganhou duas asserções, uma por linha da tabela por demanda (`Busca por SKU … loja … Execução … US$ 90,00` e `Página de contato … site … Execução … US$ 5,00`). Nenhum caso nem asserção saiu, e os números (US$ 95,00 e 2 demandas) são os mesmos: sem afrouxamento (CA-3). Em `estresse/grupos/`, `etapas.ts` e `http_leitura.ts` mudaram uma linha cada (a rota `/api/metricas/demandas` e um comentário).

Nenhum arquivo de teste foi apagado na rodada I-263.R2; só três casos saíram de arquivos que continuam (ver "Apagados nesta rodada"). As tabelas dividem o que é de cada rodada:

- **Apagados nesta rodada (I-263.R2):** só o que depende de `agregado.ts`, de `Etapa`/`Fase` ou do `TipoId` com cinco valores.
- **Já integrados pela rodada I-263.R1 (PR #115):** a cadeia de migrações 1 a 36 e os testes dela. Estão listados só para o revisor não procurá-los nesta rodada; não aparecem em `git diff 7ce3c2f..HEAD`.

### Apagados nesta rodada

| Teste | Motivo | Outra cobertura |
| --- | --- | --- |
| `primitivos.test.ts`: `Etapa e Fase têm exatamente os valores do F1` | `Etapa` e `Fase` (legados) saíram de `primitivos.ts` com `agregado.ts` | os valores de `EtapaTicket`, `EstadoDemanda`, `EstadoRodada` e `EstadoTicket` seguem em `estados SDLC têm exatamente os valores da seção 2.1` |
| `aula.test.ts`: título nulo (`ag({ issue: { …, titulo: null } })` espera `<h1>Aula do código da I-1</h1>`) | `AgregadoDemanda` exige título; o ramo de `gerarAula` para título nulo foi removido | o teste da aula confere o `<h1>` com o título da demanda, escapado (`Busca <rápida>`) |
| `banco.test.ts`, em `escrever() aninhada…`: `novoId(banco, "ticket")` e a asserção de que a sequência `ticket` não existe | `TipoId` ficou só com `issue` (o renome é da 06) | o mesmo teste segue com `issue`: a interna desfeita não deixa sequência nova e a externa segue |
| `banco.test.ts`, em `novoId()…`: a sequência independente de `ticket` (ids `[1, 1, 2]`, depois `2`) | idem; o teste virou `novoId() segue a sequência do tipo e só roda dentro da transação` (`[1, 2]`, depois `3`) | o mesmo teste, com `issue` |

### Já integrados pela rodada I-263.R1 (PR #115): testes apagados porque testavam só a cadeia de migrações 1 a 36

As migrações 1 a 36 viraram a linha de base `ESQUEMA_V36` no PR #115. Cada teste abaixo aplicava uma migração a um banco da versão anterior, e a cadeia não existe mais. Cobertura que fica: `src/persistencia/migracao_linha_de_base.test.ts` (CA-4: `sqlite_master` idêntico ao da cadeia, guardado em `linha_de_base_v36.snapshot.json`; CA-5: v36 sobe sem migração, v35 é recusado com orientação, sem alteração).

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
| `migracao_sessoes.test.ts` | CA-16 v24 → v25 só acrescenta; CA-3, 4, 5, 7 progresso do encerramento; CA-10, 11, 13 sessões, execuções e usos | CA-4; `sessoes.test.ts` (FK, CHECK) e `despacho.test.ts` |

Também do PR #115 (não são desta rodada):

| Teste | Motivo | Outra cobertura |
| --- | --- | --- |
| `banco.test.ts`: `as listas dos CHECK ... IN (...) vêm dos enums zod` | comparava `listaSql(Etapa)`, `listaSql(Fase)` e `listaSql(TipoId)` com os CHECK das migrações; `listaSql` saiu com elas. Ficou `a sequência só aceita os tipos de id conhecidos`, sem a comparação com o enum | CA-4 compara o SQL literal com o da cadeia |
| `servico.test.ts`: `…a issue sem demanda trava a subida (CA-9)` | virou `…o banco anterior à v36 é recusado sem alteração`; `bancoComIssueLegada` virou `bancoComDemanda` | CA-5 de `migracao_linha_de_base.test.ts` |
| `banco.test.ts` (demais) | versões esperadas somam `VERSAO_LINHA_DE_BASE`; a recusa de banco mais novo usa v40 contra 38; a falha de migração espera `table projeto already exists` | o mesmo teste |

### Substituídos nesta rodada (mesma regra, outro nome ou entrada)

| Teste | O que mudou |
| --- | --- |
| `aula.test.ts` | Ticket, evidência e agregado passam a ser `TicketDemanda`, `EvidenciaDemanda` e `AgregadoDemanda.parse(...)`, no lugar do `Agregado` legado montado à mão; `…pela issue` → `…pela demanda`. Mesmas asserções, menos a do título nulo |
| `schemas.test.ts` | `Agregado` → `AgregadoDemanda`; `ticket` → `ticket_id`; etapas `revisao`/`encerramento` → `revisar_rodada`/`encerrar_rodada`; evidência da demanda sem ticket é `undefined`, não `0`; `TipoEvidencia` vem de `schemas.ts` |
| `submissao.test.ts` | `TipoEvidencia` vem de `schemas.ts`; mensagem `…worktree da demanda…` |
| `servico.test.ts` | `subida sobre o banco migrado…` confere que não há tabela `iss*` (antes, só `issue`) |
| `cli.test.ts`, `agente_demanda.test.ts`, `prompt_demanda.test.ts` | o grupo `issue`, removido do CLI, é montado por concatenação ou `[i]ssue` para o `grep` do CA-2 não acusar o teste; as mesmas recusas, mais `necessidade` |
| `servidor.test.ts`, `caminhos.test.ts` | as mesmas URLs legadas com 404, montadas por concatenação (CA-2); `caminhos.test.ts` usa `/projects/:projeto/demandas/:demanda` e confere que `/projects/loja/demandas/I-3` não roteia |
| `metricas.test.ts` | `/api/metricas/issues` → `/api/metricas/demandas`, mesmo corpo (CA-3) |
| `pr.test.ts` | URL da saída inesperada do `gh` com `.../discussions/9`; é dado de entrada |
| `configuracao.test.ts` | o `doesNotMatch` da tela continua procurando o termo legado, escrito `[i]ssue` para o `grep` do CA-2 não acusar o teste |
| `chat.test.ts` | classe `issue` → `demanda` no link da demanda |
| `erros.test.ts`, `web/erros.test.ts` | mensagem `a issue I-9…` → `a demanda I-9…` |
| `dominio/*.test.ts`, `execucao/*.test.ts`, `metricas/retrabalho.test.ts`, `integracao/*.test.ts` | só o `import` (de `agregado.ts` para `ator.ts`) e comentários; nenhuma asserção mudou |

### Novos nesta rodada

`fitness/foto-base.test.ts` (prompts e saídas do CLI contra a base anterior). `src/persistencia/migracao_linha_de_base.test.ts` (CA-4 e CA-5) é do PR #115.

## CG-7 / CA-5: cópia do banco real (comprovada na rodada anterior, I-263.R1)

Esta rodada não mexe em migração nem em esquema (`git diff 7ce3c2f..HEAD -- src/persistencia/migracoes.ts src/persistencia/banco.ts` é vazio), então vale a comprovação já feita sobre o banco real em v36 pela rodada I-263.R1 (PR #115). Evidências existentes, em `~/fabriquinha/execucoes/`:

- `E-1608e7cd-cbc2-47ac-992d-c836626f2332/saida/validacao-banco.log` (e `validacao-banco.png`): cópia consistente do banco real, preparada só na cópia (agendadores desativados, `grupo_processo` zerado em 1.752 execuções, 1 execução aberta fechada com falha). `user_version` 36 → 36, `foreign_key_check` com 0 linhas antes e depois, nenhuma migração aplicada, esquema igual. **45 tabelas, 39.302 linhas no total, iguais antes e depois**; as contagens por tabela estão no log (ex.: `demanda` 287 → 287, `ticket_demanda` 1.677 → 1.677, `evidencia_demanda` 4.763 → 4.763, `execucao_sessao` 1.757 → 1.757).
- `E-73cce0f9-6adb-47b3-af20-1c3941c342e7/saida/evidencias-pr-115.md` (seção "CG-7 / CA-5") e `E-200250ab-b768-41a2-9361-fbdfed34ea17/saida/ca5-copia-resultado.txt`: as mesmas verificações em cópias `VACUUM INTO` anteriores (39.169 linhas; o banco real é vivo e cresce entre cópias, por isso os totais diferem).

Não foi refeita nesta rodada.

## Não é desta rodada (I-263.R3) e ainda não foi verificado

- **Exports sem importador e exports só de teste** (`DecisaoRef`, `classificarSaidaE2E`, `estadoExecucao`, `submeterPlanejamento`, `alterarLimiteParalelismo`, `skillsPendentes`, `metricas/projeto.ts` e os demais da demanda): continuam exportados, com os testes que os usam. Nenhum teste foi apagado por isso.
- **Parâmetro `fork` de `execucao/pi.ts`:** continua (linhas 87 e 111).
- **`fitness/sem-export-morto.test.ts`** (CA-6): não existe; `npm run fitness` não o roda.
- **CA-8:** `npm run check`, `npm run integracao`, `npm run e2e`, SonarQube e CG-9 (deploy) não foram verificados por este documento (o CG-7 está na seção anterior); valem os resultados que a Fabriquinha coleta.

`fabriquinha/07-interfaces.md` foi restaurado à versão da base (`git diff 7ce3c2f..HEAD -- fabriquinha` é vazio); o PR não deve alegar mudança nele.

## I-267.R1: estado no lugar de fase e status

A `base/` **não** foi regerada: segue sendo a foto do commit `7ce3c2f`, antes das mudanças de I-263.R2 e de I-267.R1.
A I-267.R1 renomeou `fase` e `status` para `estado` (com o nome da Etapa) e a etapa `sessao_em_aberto` para `ajustar_resultado`.
Por isso o `gerar.ts` já não roda no commit-base (ele monta o agregado com os campos novos) e a comparação passou a declarar
em `fitness/foto-base.test.ts`: os dois arquivos renomeados (`ARQUIVOS_RENOMEADOS`) e as trocas de texto (`(fase desenvolvimento)`
→ `(estado implementar)` nos prompts, os campos do JSON de `demanda ver` e `mostra a fase` → `mostra o estado` na skill).

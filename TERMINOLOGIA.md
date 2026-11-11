# Terminologia da Fabriquinha

Registro histórico dos renomes "termo atual → termo novo" que a refatoração aplicou, derivados de `CONCEITOS.md`.
A coluna "Atual" é o vocabulário de antes da refatoração; o código e os documentos usam a coluna "Novo".

## Item de Trabalho

| Atual | Novo |
|---|---|
| `TicketDemanda`, `EvidenciaDemanda`, `DecisaoDemanda` | `Ticket`, `Evidencia`, `Decisao` |
| sufixo `*Demanda` em funções (`iniciarExecucaoDemanda`, `fecharTicketDemanda`) | sem o sufixo |
| enums legados `Issue`, `Fase`, `Etapa`, `Execucao` (`src/dominio/agregado.ts`, `src/dominio/primitivos.ts`) | removidos |
| `TipoIssue`, `/api/metricas/issues` | `TipoDemanda`, `/api/metricas/demandas` |

## Ciclo de Vida

| Atual | Novo |
|---|---|
| `fase` (Demanda, Rodada), `status` (Ticket) | `estado` |
| `fase_alterada_em`, `status_alterado_em` | `estado_alterado_em` (a Rodada passa a ter) |
| fase `execucao` da Demanda | `em_execucao`, como o Ticket |
| `fechado` | `cancelado` |

## Etapa

O estado de Demanda e Rodada é a Etapa corrente.

| Atual | Novo |
|---|---|
| etapa `demanda` + fase `registro` | `entender_e_desenhar` |
| fases `planejamento`, `revisao_demanda`, `encerramento` (Demanda) | `planejar`, `revisar_demanda`, `encerrar_demanda` |
| fases `desenvolvimento`, `revisao`, `encerramento` (Rodada) | `implementar`, `revisar_rodada`, `encerrar_rodada` |
| etapa `sessao_em_aberto` + fase `sessao` | `ajustar_resultado` |
| `check_final`, `integracao`, `limpeza` | mantidos, chamados de **passos** (não etapas) |

## Gate

| Atual | Novo |
|---|---|
| fases `aprovacao_demanda`, `aprovacao_planejamento`, `aprovacao_pull_request` | `gate_demanda`, `gate_planejamento`, `gate_pr` |
| `recusado`, `aprovado: boolean`, "devolver" | `aprovado` / `reprovado` |
| `DecisaoDemanda` sem gate | `Decisao` com campo `gate` |

## Trabalho Agêntico e Uso

| Atual | Novo |
|---|---|
| `Sessao` (pi) | `TrabalhoAgentico` (gerenciado) |
| `ExecucaoSessao` (cada processo do pi) | `ProcessoDoTrabalho` |
| `sessao_externa_demanda`, `origem_ferramenta`/`origem_sessao` | `TrabalhoNaoGerenciado {ferramenta, sessao}` |
| `ModoExecucao` | `ModoTrabalho` (autonomo, interativo, consulta) |
| `UsoModeloExecucao`, `custos_realizados`, `arvore_prs_criterios_custos` | `Uso` |
| par modelo + effort (repetido em cinco lugares) | `ConfiguracaoAgente` |

O `ProcessoDoTrabalho` serve à recuperação (`pgid`); a `Tentativa` é registro à parte, para limites e métricas.
Uma Tentativa nova pode acontecer dentro do mesmo processo (devolução da D05 com o pi vivo).

## Evidência e Tentativa

| Atual | Novo |
|---|---|
| `TipoEvidencia`, `TipoEvidenciaAgregado`, `TipoEvidenciaDemanda`, `TipoEvidenciaEtapa` | `TipoEvidencia` (lista única) |
| `aprovada` dentro de `dados` | removido |
| (sem registro próprio) | `Tentativa` |
| `devolucoes`, `retomadas_automaticas` | `reprovacoes`, `falhas_infraestrutura` |
| `motivo_falha` (ticket), `erro` (execução) | `motivo` |
| prefixo `"falha de infraestrutura"` + regex | `ClasseFalha` tipada |

## Ator, Projeto e Pendência

| Atual | Novo |
|---|---|
| `Produtor`, `ProdutorEvidenciaEtapa`, `TipoAtor`, `AutorDemanda`, `IdentidadeOrigem` | `Ator` |
| `origem` do ticket | `criado_por` |
| `Projeto` (`repo`, `branchBase`) + `ConfiguracaoProjeto` (`raiz_git`, `branch_base`) | `Projeto` (`raiz_git`, `branch_base`) |
| `EsperaDoAuditor`, `MotivoDaEspera`, `MotivoDemanda` | `Pendencia`, `TipoPendencia` |

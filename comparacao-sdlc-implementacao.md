# Especificação técnica — SDLC por demandas e rodadas

## 1. Modelo implementado × modelo requerido

A coluna **Atual** corresponde ao código do working tree, não ao comportamento descrito antecipadamente em `fabriquinha/*.md`. A coluna **Alvo** corresponde ao Draw.io; decisões que o desenho não fecha estão discriminadas na seção 13. **Proposta técnica** identifica complementos de implementação, não regras já aprovadas no diagrama.

| Aspecto | Atual | Alvo | Alteração necessária |
| --- | --- | --- | --- |
| Unidade de acompanhamento | `Issue`, com uma fase global e uma sequência de tickets. | Demanda contendo rodadas; demanda, rodada e ticket têm estados distintos. | Introduzir agregado de rodadas e separar suas transições das transições da demanda. |
| Registro e desenho | Registro interno ou externo, seguido de desenho interativo dentro da Fabriquinha. | Entendimento e desenho fora da Fabriquinha; IA externa registra critérios, desenho e custos e envia a demanda ao Auditor. | Substituir o percurso de registro/desenho dos novos registros; preservar os registros históricos. |
| Aprovação da demanda | `decidirRegistro` aprova para desenho; reprovação devolve o registro para ajuste. | Aprovação libera planejamento; recusa cancela o percurso. | Gate específico de demanda, sem reutilizar a semântica de devolução do registro. |
| Planejamento | Tickets de desenvolvimento criados no desenho; não há entidade de rodada. | Plano de rodadas, tickets, dependências, critérios e arquivos; decisão humana antes da execução. | Criar submissão e aprovação do plano; congelá-lo somente após preparação bem-sucedida. |
| Execução | No máximo uma execução ativa por issue; tickets de desenvolvimento ordenados por ID. | Rodadas independentes executam em paralelo; uma execução por rodada e um ticket de implementação por vez. | Mudar seleção, reserva e bloqueios de issue para escopo de rodada, mantendo exclusão dos trabalhos globais. |
| Término da implementação | Aplicação verifica resultado após o agente terminar; coleta testes, fitness, Sonar e commit. | A aplicação continua responsável por verificar; não há submissão CLI da implementação. | Reaproveitar o mecanismo e acrescentar contexto de demanda/rodada. Não criar comando de conclusão para o agente. |
| Revisão e correções | Revisão da issue; reprovação cria tickets e repete desenvolvimento/revisão/encerramento. | Revisão por rodada e revisão integral posterior; esta última pode criar novas rodadas corretivas. | Separar os dois escopos e os respectivos gates e artefatos. |
| Branch/worktree | Uma branch e worktree por issue, `fabriquinha/I-n`. | Branch da demanda e branch/worktree de cada rodada. | Integrar PRs de rodada na demanda e integrar a demanda na base apenas ao final. |
| PR e decisão humana | Um PR por issue, contra a base; aprovação com integração conclui a issue. | PR por rodada contra a demanda; aprovação conclui somente a rodada. | Escopar PR, decisão e integração pela rodada. |
| Ajustes de PR | Sessão interativa cria tickets corretivos. | Conversa abre imediatamente, sem implementação nem integração; só libera execução após registrar correções. | Preservar a interação, restringindo-a à rodada e ao trabalho de ajuste. |
| Encerramento final | Conclusão vinculada à aprovação humana do PR da issue. | Revisão integral aprovada libera publicação/integração/limpeza automáticas; não há novo gate humano. | Criar encerramento da demanda com progresso recuperável e agente somente para resolução de conflito. |
| Evidência | Um tipo por ticket; nova submissão substitui a anterior. Anexos endereçados por conteúdo. | Um tipo por dono: demanda, rodada ou ticket; anexos em relação própria. | Expandir propriedade sem transformar evidências em histórico de versões. |
| Sessão e execução | `sessaoPi`, modo e ticket presentes em cada `Execucao`; retomadas compartilham a sessão principal. | Sessão explícita, contendo várias execuções; consumo por execução e par provedor/modelo. | Separar identidades e preservar referências às conversas e tentativas. |
| Configuração de projeto | Testes em lista, preparação, fitness, Sonar e modelos por etapa. | Linguagens por caminho, configuração E2E, globs e effort por etapa/ticket. | Normalizar os novos contratos e manter configurações existentes até migração validada. |
| Serviços de aplicação | Responsabilidades distribuídas em domínio, sessões, executor, coletores e rotas. | Sete serviços lógicos nomeados na sequência. | Explicitar contratos e coordenação sem pressupor microserviços, broker ou transporte interno. |

`Entrega`, IDs `N-n`, fases de demanda e endpoints de entregas descritos nos documentos atuais não existem nos contratos implementados. Não há migração de uma entidade `Entrega` já persistida. A interface operacional `Rodada` em `src/execucao/gerente.ts` também não representa a entidade de negócio do ERD.

## 2. Estados, identidades e escopos

### 2.1 Estados do ERD

| Conceito | Valores semânticos do diagrama |
| --- | --- |
| Fase da demanda | registro; aprovação da demanda; planejamento; aprovação do planejamento; execução; revisão da demanda; encerramento; concluída; arquivada; cancelada |
| Fase da rodada | desenvolvimento; revisão; encerramento; aprovação do pull request; sessão; concluída |
| Etapa do ticket | demanda; planejar; implementar; revisar a rodada; encerrar a rodada; sessão em aberto; revisar a demanda; encerrar a demanda; resolver conflito |
| Status do ticket | aberto; em execução; concluído; falhou; fechado; cancelado |

Esses conjuntos são independentes: uma demanda permanece em execução enquanto suas rodadas estão em fases diferentes. A fase da rodada não deve ser inferida da fase da demanda; status de ticket não substitui fase de rodada. O enum técnico e a correspondência entre “registro” e “demanda” permanecem sujeitos à decisão D01.

Atualmente, `src/dominio/primitivos.ts` contém apenas as etapas `registro`, `desenho`, `desenvolvimento`, `revisao`, `encerramento`, `sessao`; as fases também pertencem ao ciclo único da issue. Não basta renomear esses enums.

### 2.2 Identidades

- Demanda: `demanda_id` textual.
- Rodada: chave composta `(demanda_id, rodada_id)`, com número local à demanda.
- Ticket: chave composta `(demanda_id, ticket_id)`, também local à demanda, com `rodada_id` opcional.
- Decisão: chave `(demanda_id, ticket_id, decisao_id)`, com sequência local ao ticket.
- Sessão, execução e evidência: IDs textuais próprios.
- Toda referência a ticket ou rodada deve carregar a demanda. Um número isolado não identifica globalmente esses objetos.
- O ticket pertence sempre à demanda; tickets globais, como planejamento e revisão integral, não precisam pertencer a uma rodada.

**Proposta técnica de compatibilidade:** representar demandas históricas como `I-{id_atual}`, mantendo os números existentes de tickets dentro da respectiva demanda, sem renumeração destrutiva. A forma pública de endereçar IDs compostos deve ser definida em D09; `T-3` sozinho deixa de ser suficiente.

### 2.3 Branches

| Escopo | Nome explícito no ERD | Destino de integração |
| --- | --- | --- |
| Demanda | `fabriquinha/{demanda_id}` | Base do projeto; divergência `main` × `branch_base` em D02. |
| Rodada | `fabriquinha/{demanda_id}-{rodada_id}` | `fabriquinha/{demanda_id}` |

Cada rodada executa em sua própria worktree. A branch da demanda reúne as rodadas integradas e é o objeto da revisão integral. A atribuição do ponto de partida de rodadas dependentes e a atualização de branches defasadas devem ser fechadas em D04.

**Proposta técnica:** manter a worktree de agregação da demanda e acrescentar caminhos de rodada sob `worktrees/<projeto>/<demanda_id>/rodadas/<rodada_id>`. Validar IDs usados em caminhos e refs; não aceitar travessia de diretórios ou sobrescrita de branches de terceiros.

## 3. Transições da demanda

| Origem/evento | Responsável | Pré-condições e efeito | Destino |
| --- | --- | --- | --- |
| Registrar/editar | IA externa, via CLI | Persistir conteúdo e origem da ferramenta/sessão. Entendimento e desenho já ocorreram fora da aplicação. | Registro |
| Enviar | IA externa | Validar critérios, desenho, custos e demais artefatos exigidos. Envio inválido informa pendências e permite correção, sem abrir gate válido. Envio aceito congela conteúdo. | Aprovação da demanda |
| Aprovar demanda | Auditor, via HTTP/web | Registrar decisão e disponibilizar planejamento; execução respeita dependências entre demandas. | Planejamento |
| Recusar demanda | Auditor | Registrar recusa; cancelar demanda e dependentes elegíveis conforme D08; preservar histórico. | Cancelada |
| Submeter plano | Agente de planejamento, via CLI | Apresentar rodadas, tickets, critérios, arquivos e dependências. | Aprovação do planejamento |
| Reprovar planejamento | Auditor | Motivo obrigatório no caminho de reprovação da sequência; retomar a mesma sessão de planejamento para ajuste. | Planejamento |
| Aprovar planejamento | Auditor + Planejamento | Preparar os recursos necessários e congelar o plano. Somente confirmar aprovação após preparação concluída. Falha mantém o gate aberto e não libera desenvolvimento. | Execução |
| Concluir todas as rodadas | Execução | Não pode haver rodada pendente ou corretiva por concluir. | Revisão da demanda |
| Reprovar revisão integral | Agente revisor | Registrar comprovações/decisão e novas rodadas corretivas. Estas percorrem implementação, revisão, encerramento, PR e integração. | Execução |
| Aprovar revisão integral | Agente revisor | Verificações globais aplicáveis e comprovações aprovadas. | Encerramento |
| Integrar e limpar | Encerramento | Confirmar integração final e conclusão da limpeza, inclusive após retomadas. Não abrir outro gate humano. | Concluída |
| Cancelar durante o percurso | Auditor → Gestão de Demandas → Execução | Respeitar condições de cancelamento; interromper trabalho permitido e manter histórico. | Cancelada |
| Arquivar concluída | Operação posterior ao fluxo | Preservar consulta e histórico; não executar novamente. | Arquivada |

O planejamento só pode começar quando todas as demandas predecessoras estiverem concluídas. Dependências podem atravessar projetos. A forma de tratar dependências já arquivadas, antes representadas por `fase = concluida` mais timestamp, precisa ser definida em D08.

Congelamento de conteúdo não impede registrar custos realizados, decisões, execuções e evidências das etapas posteriores. Alteração de escopo não pode ocorrer por edição silenciosa dos critérios enviados.

## 4. Transições e execução das rodadas

| Origem/evento | Ação obrigatória | Destino |
| --- | --- | --- |
| Rodada pronta | Selecionar ticket elegível e implementar um por vez. | Desenvolvimento |
| Todas as implementações concluídas | Abrir revisão da rodada. Não confundir processo pi encerrado com ticket concluído. | Revisão |
| Revisão reprovada | Registrar exigências e tickets corretivos; repetir implementação e revisão. | Desenvolvimento |
| Revisão aprovada | Liberar produção da documentação do PR. | Encerramento |
| Documentação entregue | Publicar ou atualizar PR da rodada e conferir conflito/checks. | Verificação pela aplicação |
| PR com conflito ou check falho | Criar/disponibilizar correções antes de apresentar novo gate humano. | Desenvolvimento |
| PR sem conflito e sem check falho | Apresentar PR para decisão do Auditor. | Aprovação do pull request |
| PR reprovado | Exigir motivo e abrir imediatamente conversa de ajustes, sem esperar agendador. | Sessão |
| Ajustes combinados | Exigir trabalho corretivo registrado antes de concluir a conversa. Não implementar nem integrar durante a conversa. | Desenvolvimento |
| Aprovação solicitada | Integrar PR na branch da demanda e confirmar o resultado externo. | Gate ainda aberto até confirmação |
| Integração confirmada | Registrar aprovação efetiva e conclusão da rodada. | Concluída |
| Integração falhou | Não registrar aprovação efetiva nem concluir rodada. Preservar gate e progresso para nova tentativa. | Aprovação do pull request |

Reprovação de PR exige motivo (`Sequência da demanda:texto_60`). A mensagem `mensagem_165` diz “aprovar ou reprovar o PR, com nota”; o alcance da nota também na reprovação precisa ser fechado em D03. Hoje o código exige nota 1–5 ao aprovar e motivo ao reprovar; não transportar essa assimetria silenciosamente como decisão do novo fluxo.

Reprovação da revisão integral cria **novas rodadas corretivas**, não reabre silenciosamente rodadas já integradas. O novo ciclo completo precisa terminar antes da próxima revisão integral.

### 4.1 Seleção e concorrência

- Execução seleciona trabalho; o agente não escolhe qual ticket ou rodada executar em seguida.
- O disparo periódico e o comando HTTP “Executar agora” passam pela mesma verificação de elegibilidade.
- Dependências entre rodadas ficam na mesma demanda. Dependências entre tickets ficam na mesma rodada.
- Dependências não podem conter ciclos nem autorreferência.
- Rodadas sem dependências pendentes podem avançar simultaneamente, cada uma em sua worktree.
- Dentro de uma rodada, há uma execução por vez e implementação sequencial de tickets. Dependências substituem o critério atual de simples ordem global por ID como restrição de execução.
- Trabalhos globais da demanda não podem concorrer com rodadas que invalidem seu resultado. A revisão integral começa somente após todas as rodadas concluídas.
- Falha de ticket bloqueia o escopo correspondente até reabertura pelo Auditor com instrução. Não deve bloquear automaticamente rodadas independentes por reaplicação do lock global atual da issue.
- Limites de paralelismo, desempate entre tickets elegíveis e convivência com sessões de consulta dependem de D04/D05.

**Proposta técnica:** manter SQLite e o serviço de instância única. Reservar trabalho e criar a execução atomicamente, reconferindo elegibilidade na transação; executar pi, git, testes e hospedagem fora dela. Manter a fila de operações git por projeto para mutações compartilhadas, sem serializar toda a execução dos agentes. Não há requisito para broker ou pool distribuído.

### 4.2 Falha, interrupção e reabertura

- Falha, timeout ou reinício não aprovam gates nem avançam automaticamente a etapa.
- Registrar a execução encerrada e a falha do trabalho correspondente, preservando logs, conversa, branch e worktree.
- Reabertura exige instrução do Auditor e preserva o trabalho existente.
- Reabrir não dispara a execução imediatamente: a próxima seleção elegível retoma a mesma sessão.
- A conversa de ajustes de PR é a exceção explícita: abre imediatamente após reprovação.
- Sucesso do processo do agente e aprovação das verificações da aplicação são resultados diferentes.

Hoje, `executarAutonomo` permite duas devoluções técnicas automáticas do mesmo ticket por reprovação de testes/fitness/Sonar/hooks; a terceira falha. Esse comportamento não deve ser transportado implicitamente: D05 precisa distinguir reprovação técnica corrigível de falha bloqueante no novo contrato.

## 5. Encerramento final e recuperação

Aprovação da revisão integral libera o serviço Encerramento. Não existe sessão final de aprovação humana no alvo. `sessao_final` também não é uma etapa implementada hoje; aparece apenas em documentação antecipada.

| Situação | Comportamento requerido |
| --- | --- |
| Primeira tentativa | Reconhecer progresso existente; publicar/atualizar PR final e conferir condições. |
| Conflito de merge | Disponibilizar resolução por agente, delegada logicamente a Implementação; executar suas verificações e liberar nova tentativa. Contrato exato em D06. |
| Check final falho | Registrar falha, informar ao Auditor e permitir reabertura. Não integrar nem limpar; não abrir automaticamente agente de implementação nesse caminho. |
| PR apto | Integrar a demanda na base e confirmar integração. Não solicitar nova decisão humana. |
| Integração falhou | Preservar progresso, informar falha e permitir nova tentativa após reabertura. |
| Integração já confirmada | Não integrar novamente; retomar somente a limpeza pendente. |
| Limpeza incompleta | Registrar falha parcial sem desfazer a integração. Reabertura repete apenas a parte pendente. |
| Integração e limpeza confirmadas | Marcar demanda concluída e preservar histórico. |

**Proposta técnica de persistência do progresso:** armazenar, por encerramento, identidade do PR, branches/base e SHA verificados, confirmação externa da integração e pendências de limpeza. O ERD não fornece estrutura suficiente para esse checkpoint; a representação deve ser definida em D06. Não usar somente a fase global para decidir se um efeito externo precisa ser repetido.

Reconciliação deve cobrir queda entre efeito externo e gravação no banco: PR já criado, merge já realizado ou recurso já removido. Repetir uma solicitação não pode duplicar PR, decisão, integração ou exclusão. O código atual já contém recuperação específica de commit órfão e de PR publicado antes da persistência; esses mecanismos devem ser reaproveitados, mas não constituem idempotência geral do novo encerramento.

## 6. Contratos dos serviços de aplicação

Os sete serviços são fronteiras lógicas da página “Sequência da demanda”. CLI e HTTP são adaptadores; não implementam regras das etapas. O diagrama não prescreve endpoints novos, chamadas síncronas, eventos ou processos separados.

| Serviço | Operações e entradas mínimas | Resultado e invariantes |
| --- | --- | --- |
| Gestão de Demandas | Registrar/editar; enviar conteúdo e evidências; decidir demanda; cancelar demanda/dependentes elegíveis. Contexto: projeto, demanda, ator, origem externa. | Conteúdo validado/congelado, decisão ou pendências; disponibilização do planejamento; coordenação da interrupção por Execução. |
| Execução | Selecionar/reservar trabalho elegível; executar agora; acompanhar, interromper e reabrir; conduzir etapa selecionada. Contexto: demanda, rodada opcional, ticket e sessão. | Execução rastreável; nenhuma escolha de próximo trabalho pelo agente; exclusão/retomada respeitando o escopo. |
| Planejamento | Iniciar/retomar sessão; submeter plano; ajustar/decidir; preparar e congelar plano. | Grafo de rodadas/tickets validado; gate aberto em falha de preparação; desenvolvimento liberado somente após confirmação. |
| Implementação | Conduzir ticket e verificar resultado após término da resposta; receber resolução de conflito final conforme D06. | Verificações da aplicação, commit/rastreabilidade e conclusão ou falha bloqueante. Sem comando CLI de submissão da implementação. |
| Revisão | Conduzir revisão de rodada ou integral; receber comprovações e decisão; executar verificações globais aplicáveis. | Aprovação ou trabalho corretivo no escopo adequado; nova revisão após correções. |
| Encerramento | Receber documentação da rodada; publicar/conferir/integrar PR de rodada; conduzir integração final e limpeza. | Conclusão somente após confirmação do efeito externo; progresso recuperável; gate humano só nas rodadas. |
| Ajustes de PR | Abrir conversa imediatamente; receber mensagens; registrar/ajustar correções; concluir conversa. | Nenhuma implementação ou integração na conversa; retorno ao desenvolvimento somente com correções registradas. |

As operações devem receber identidades completas e validar ator, fase, escopo, execução ativa e congelamentos na fronteira de aplicação/domínio, não apenas na interface. O contexto do agente deve identificar a demanda, o ticket composto, a rodada quando aplicável e a execução/sessão autorizada.

O ERD exige registrar ferramenta e sessão da origem externa. Atualmente `EXTERNO` não carrega esses identificadores. **Proposta técnica de autorização, sujeita a D09:** restringir as ações anteriores ao envio à ferramenta/sessão autora correspondente; essa restrição não está explicitada no diagrama.

## 7. Modelo relacional requerido

`?` indica campo anulável. Os nomes e tipos abaixo reproduzem o ERD lógico, não SQL já existente. Campos de controle e histórico hoje persistidos não devem ser descartados por estarem ausentes do desenho; ver seção 10.

### 7.1 Projeto e configuração

| Entidade | Chave | Demais atributos |
| --- | --- | --- |
| `Projeto` | `nome: texto` | `branch_base: texto`, `chave_sonarqube: texto`, `raiz_git: caminho`, `hospedagem: texto`, `cursor_commit_humano: texto?` |
| `ConfiguracaoEtapaProjeto` | `(projeto_nome, etapa)` | `modelo_provedor: texto?`, `modelo_nome: texto?`, `effort: texto?` |
| `ComandoPreparacaoProjeto` | `(projeto_nome, ordem)` | `comando: texto` |
| `FitnessFunctionProjeto` | `(projeto_nome, nome)` | `comando: texto`, `descricao: texto` |
| `LinguagemProjeto` | `(projeto_nome, caminho)` | `linguagem: texto`, `comando_teste: texto` |
| `ConfiguracaoE2E` | `(projeto_nome, caminho_linguagem)` | `comando_build: texto`, `comando_execucao: texto`, `codigo_falha: inteiro` |
| `GlobE2E` | `(projeto_nome, caminho_linguagem, glob)` | Sem atributos adicionais. |

Regras explícitas:

- Todas as configurações referenciam seu projeto; E2E referencia a chave completa de `LinguagemProjeto`; globs referenciam a configuração E2E correspondente.
- Projeto possui uma ou mais linguagens/caminhos. A mesma linguagem pode aparecer em caminhos diferentes.
- Configuração E2E é opcional por linguagem/caminho. `codigo_falha` deve estar entre 1 e 255; o significado operacional desse código está em D07.
- Glob é relativo à raiz git.
- Preparação respeita `ordem`.
- `modelo_provedor` e `modelo_nome` ficam ambos preenchidos ou ambos nulos. O par é validado no harness, sem catálogo local inventado.
- `effort`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- Modelo e effort são opcionais independentemente. Ausência utiliza o padrão da etapa/harness; a precedência por campo entre projeto e ticket deve ser definida em D07.

### 7.2 Demanda, rodada e ticket

| Entidade | Chave | Demais atributos |
| --- | --- | --- |
| `Demanda` | `demanda_id: texto` | `projeto_nome: texto`, `titulo: texto`, `tipo: texto`, `descricao: texto`, `fase: texto`, `fase_alterada_em: data/hora`, `origem_ferramenta: texto`, `origem_sessao: texto`, `enviada: booleano`, `branch: texto` |
| `DependenciaDemanda` | `(demanda_id, depende_demanda_id)` | Duas referências a demandas. |
| `Rodada` | `(demanda_id, rodada_id: inteiro)` | `titulo: texto`, `fase: texto`, `e2e: booleano`, `branch: texto` |
| `DependenciaRodada` | `(demanda_id, rodada_id, depende_rodada_id)` | Duas referências a rodadas da mesma demanda. |
| `CriterioCitadoRodada` | `(demanda_id, rodada_id, criterio_id)` | `criterio_id: texto (CA-n)` |
| `Ticket` | `(demanda_id, ticket_id: inteiro)` | `rodada_id: inteiro?`, `titulo: texto`, `descricao: texto`, `etapa: texto`, `status: texto`, `status_alterado_em: data/hora`, `modelo_provedor: texto?`, `modelo_nome: texto?`, `effort: texto?` |
| `DependenciaTicket` | `(demanda_id, ticket_id, depende_ticket_id)` | Duas referências a tickets da mesma rodada. |
| `CaminhoTicket` | `(demanda_id, ticket_id, caminho)` | `caminho: texto` |
| `DecisaoTicket` | `(demanda_id, ticket_id, decisao_id: inteiro)` | `data: data/hora`, `resultado: texto`, `nota: inteiro?`, `motivo: texto?`, `quem_decidiu: texto` |

Regras explícitas:

- Toda FK de rodada ou ticket inclui `demanda_id`.
- `Ticket(demanda_id, rodada_id)` referencia a rodada quando preenchido.
- FKs de `DependenciaRodada`: `(demanda_id, rodada_id)` e `(demanda_id, depende_rodada_id)`.
- FKs equivalentes para dependências de tickets; além da integridade referencial, ambos devem pertencer à mesma rodada. Tickets globais não recebem dependências de rodada por inferência.
- Todos os grafos de dependência são acíclicos e sem autorreferência.
- `CriterioCitadoRodada` referencia logicamente os `CA-n` do payload de critérios da demanda. Não é FK SQL para um campo JSON.
- Nota, quando exigida pelo gate, pertence ao intervalo 1–5.
- O desenho não define todos os domínios de `resultado`/`quem_decidiu`, a matriz de obrigatoriedade de motivo/nota nem quais etapas exigem `rodada_id`; decisões D03/D09.

### 7.3 Sessões, execuções e consumo

| Entidade | Chave | Demais atributos |
| --- | --- | --- |
| `Sessao` | `id: texto` | `demanda_id: texto`, `ticket_id: inteiro`, `modo: texto`, `conversa_referencia: texto` |
| `Execucao` | `id: texto` | `sessao_id: texto`, `inicio: data/hora`, `fim: data/hora?`, `falha: booleano` |
| `UsoModeloExecucao` | `(execucao_id, modelo_provedor, modelo_nome)` | `tokens_entrada: inteiro`, `tokens_saida: inteiro`, `tokens_cache_leitura: inteiro`, `tokens_cache_escrita: inteiro`, `custo: decimal?` |

- Um ticket pode abrir sessões; uma sessão dispara execuções. Retomadas preservam a conversa correspondente.
- `Sessao(demanda_id, ticket_id)` referencia o ticket composto; execução referencia a sessão.
- `conversa_referencia` aponta para o identificador/caminho do documento da conversa. Não normalizar mensagens em tabelas por conta desta alteração.
- Uso é agregado por execução e par provedor/modelo; uma mesma execução pode consumir mais de um modelo.
- Custo ausente não significa zero. Somatórios e exibição precisam distinguir total conhecido de custo incompleto.
- Tokens/custos pertencem ao uso da execução, não a um objeto aninhado na sessão.
- `fim = NULL` representa execução não encerrada; `falha` sozinho não permite inferir sucesso enquanto não houver fim.

### 7.4 Evidências e arquivos

| Entidade | Chave | Demais atributos |
| --- | --- | --- |
| `Evidencia` | `id: texto` | `demanda_id: texto`, `rodada_id: inteiro?`, `ticket_id: inteiro?`, `tipo: texto`, `dados_json: documento opaco`, `quem_gravou: texto` |
| `ArquivoEvidencia` | `(evidencia_id, ordem: inteiro)` | `caminho: texto` |

- `demanda_id` é obrigatório, inclusive para evidência de rodada/ticket.
- `rodada_id` e `ticket_id` são mutuamente exclusivos; ambos nulos indicam dono demanda.
- Evidência de ticket **não** preenche também `rodada_id`; a rodada é encontrada pelo ticket.
- Validar existência e contexto do dono com FK composta.
- Há no máximo uma evidência de determinado tipo por dono. Nova submissão substitui a anterior.
- `dados_json` continua opaco no modelo relacional; isso não elimina validação do payload na entrada conforme o tipo de evidência.
- Arquivos têm linhas próprias e ordem; referências não devem permitir leitura fora do armazenamento autorizado.

**Proposta técnica para SQLite:** aplicar `CHECK (rodada_id IS NULL OR ticket_id IS NULL)` e três índices únicos parciais: demanda/tipo quando ambos nulos; demanda/rodada/tipo quando a rodada estiver preenchida; demanda/ticket/tipo quando o ticket estiver preenchido. Um único `UNIQUE` com colunas anuláveis não garante a unicidade desejada.

Preservar armazenamento por SHA-256, permissões e verificação de integridade atuais. O ERD não autoriza converter anexos em caminhos arbitrários nem eliminar hashes, MIME ou tamanho já guardados. A representação compatível do caminho e desses metadados deve ser fechada em D10.

### 7.5 Cardinalidades do ERD

| Relação | Cardinalidade explícita |
| --- | --- |
| Projeto → demandas, configurações de etapa, preparação, fitness | `1 → 0..N` em cada relação. A aplicação atual exige ao menos uma fitness; a diferença não autoriza relaxar o gate sem D03. |
| Projeto → linguagens/caminhos | `1 → 1..N` |
| Linguagem/caminho → configuração E2E | `1 → 0..1` |
| Configuração E2E → globs | `1 → 1..N` |
| Demanda → rodadas | `1 → 0..N` |
| Demanda → tickets | `1 → 1..N`; como satisfazer a cardinalidade já no registro é parte de D09. |
| Rodada → tickets | Uma rodada agrupa `1..N` tickets; cada ticket pertence a `0..1` rodada. |
| Origem/pré-requisito → registros de dependência | `1 → 0..N`; cada linha liga exatamente os dois objetos de seu grafo. |
| Rodada → critérios citados | `1 → 0..N`; o desenho não exige pelo menos um critério por rodada. |
| Ticket → caminhos, decisões e sessões | `1 → 0..N` em cada relação. |
| Sessão → execuções; execução → usos por modelo | `1 → 0..N` em cada relação. |
| Demanda → evidências | `1 → 0..N`, com contexto da demanda obrigatório em toda evidência. |
| Rodada/ticket → evidências | Cada objeto pode ter `0..N`; evidência referencia `0..1` rodada ou `0..1` ticket, com exclusão mútua. |
| Evidência → arquivos | `1 → 0..N` |

Cardinalidade mínima do lado dos filhos não é garantida apenas por FK. Definir em qual comando/gate validar mínimos obrigatórios; não criar linhas artificiais para satisfazer o desenho.

## 8. Evidências, métricas e melhoria do SDLC

### 8.1 Reutilização do mecanismo atual

`src/dominio/evidencia.ts` já define catálogo por etapa e produtor, exigência de aprovação, substituição por tipo/ticket e restrições de submissão. `src/evidencias/coleta.ts`, `src/execucao/autonoma.ts` e o repositório já coordenam coleta/verificação/commit após o agente terminar.

O novo catálogo precisa separar:

- Evidências de definição da demanda, submetidas externamente antes do envio.
- Evidências do plano e da distribuição de critérios/arquivos por rodada.
- Evidências técnicas de implementação, verificadas pela aplicação.
- Comprovações e decisão de revisão por rodada.
- Documentação e PR da rodada.
- Comprovações da revisão integral e resultado do encerramento final.

A relação entre **produtor**, **dono da evidência** e **ticket que executa a etapa** deve ser explícita. Não transferir automaticamente toda evidência de revisão para o dono rodada: isso substituiria a prova anterior a cada revisão; a granularidade exata do catálogo depende de D03.

### 8.2 Artefatos explícitos de `Page-1`

Os nomes desta tabela são rótulos do desenho, não novos tipos já disponíveis no CLI. O catálogo definitivo deve conciliar listas textuais e documentos desenhados, que não são idênticos em todos os casos.

| Etapa alvo | Artefatos/verificações do desenho | Correspondência atual e diferença |
| --- | --- | --- |
| Entendimento e desenho externos | Critérios de aceite; desenho da solução. | Existem `criterios_aceite` no registro e `desenho_solucao` no desenho interno; mudar produtor/percurso e escopo. Comportamento, protótipo e relatórios adicionais atuais não são automaticamente removidos: D03 define o catálogo. |
| Planejamento | Proposta de rodadas e tickets; lista de arquivos a alterar × rodadas. | O desenho atual gera tickets e possui relatórios de complexidade/impacto, mas não representa esse plano por rodadas. Acrescentar as duas estruturas e validações de consistência. |
| Implementação | Aprovação de todos os testes; SAST/SonarQube; execução de testes e relatório Sonar desenhados como documentos. | Testes, fitness e Sonar já são coletados e exigidos pelo catálogo atual. Reescopar e definir em D03/D07 como linguagens/E2E participam, sem eliminar fitness por omissão na lista textual. |
| Revisão da rodada | Comprovação de critérios com vídeos/imagens; relatório de arquivos alterados × desenho inicial; matriz de fitness com explicações. | Existem `arquivos_alterados`, `matriz_fitness`, `explicacao_fitness`, `comprovacao_criterios`; incorporar vínculo ao plano/rodada e critérios citados. |
| Encerramento da rodada | Lista textual: mensagem PR, dados do trabalho no banco local, explicação do código. Documentos desenhados: vídeo, PR aberto, explicação do código. | Existem `mensagem_pr`, `aula_codigo`, `video_demonstracao` opcional, `relatorio_produtividade` e `pr_aberto`; definir equivalências e obrigatoriedade, sem presumir que vídeo seja sempre obrigatório. |
| Revisão integral da demanda | Checagem dos critérios da demanda; testes de estresse; análise de segurança. | Não existe essa etapa global separada. Especificar comandos/evidências e critérios de aprovação; SAST de implementação não substitui automaticamente essa análise. |
| Encerramento da demanda | Documentos desenhados: vídeo, PR aberto, relatório de produtividade do SDLC. Não há lista textual própria de evidências. | Reutilizar coletores/artefatos existentes no novo escopo, sem transformar ausência de lista textual em dispensa nem inventar execução de agente no caminho normal. |

### 8.3 Requisitos de verificação

- A aplicação não aceita a declaração do agente como prova suficiente de testes/fitness/Sonar aprovados.
- A implementação só conclui após as verificações aplicáveis e rastreabilidade do commit. Esse mecanismo já existe e deve ser adaptado ao escopo da rodada.
- Revisão precisa ligar critérios às comprovações; rodada cita critérios existentes na demanda congelada.
- Revisão reprovada precisa materializar o trabalho corretivo antes de liberar o retorno ao desenvolvimento.
- A revisão integral avalia o resultado agregado na branch da demanda, não apenas o último PR ou ticket.
- O PR apresentado ao Auditor deve corresponder à branch/demanda/rodada verificadas; mudança externa exige reconferência antes da integração.
- Checks falhos e conflitos têm tratamento diferente no encerramento final; não reutilizar indiscriminadamente a regra atual de correção automática do PR da issue.

A substituição de evidência por tipo/dono não transforma a evidência anterior em versão histórica. Decisões, execuções, uso e registros de comandos continuam rastreáveis; qualquer exigência adicional de versionar payloads é uma decisão separada, não consta do ERD.

### 8.4 Indicadores do desenho

| Etapa | Indicadores explícitos |
| --- | --- |
| Entendimento/desenho | Tokens por modelo e custo total; quantidade de aprovações/reprovações. |
| Planejamento | Tokens por modelo e custo total; percentual de conformidade do PR com a lista de arquivos a alterar. |
| Implementação | Tokens por modelo e custo total; quantidade de alterações posteriores no código desenvolvido. |
| Revisão da rodada | Tokens por modelo e custo total; quantidade de exigências de alterações; bugs em arquivos revisados. |
| Encerramento da rodada | Tokens por modelo e custo total; feedback humano de qualidade/rating. |
| Revisão integral | Tokens por modelo e custo total; quantidade de exigências de alterações; bugs em arquivos revisados. |
| Encerramento da demanda | Relatório de produtividade do SDLC; não há lista de indicadores própria no bloco descritivo. |

`Page-1` não define fórmulas, janelas de medição ou limiares para todos esses indicadores. São métricas de sucesso, não novos gates implícitos. O detalhamento de cortes por rodada e atribuição a revisões globais pertence a D03/D10.

| Indicador | Implementação atual comprovada | Adequação/limite |
| --- | --- | --- |
| Consumo | `src/metricas/uso.ts::coletarUso` agrega tokens/caches/custo por provedor/modelo na janela da execução, incluindo subagentes; `issue.ts::metricasDaIssue` consolida. | Preservar janelas de execução e ausência de custo; separar custos externos e grupos por rodada. Não equivale a orçamento ou meta. |
| Decisões | `metricasDaIssue` expõe histórico e conta reprovações por etapa; separa correções do registro/desenho. | Adaptar gates; aprovações existem no histórico, mas não têm contador agregado próprio nesse schema. Correção não é sinônimo de reprovação. |
| Conformidade de arquivos | `issue.ts::numerosDoDesenho` conta arquivos previstos; `arquivosAlterados` conta realizados. | Não existe comparação de conjuntos, extras/ausentes ou percentual de conformidade do PR. Definir numerador/denominador, renomes/exclusões e plano de referência antes de implementar o indicador. |
| Alterações posteriores | `retrabalho.ts::registrarRetrabalho` usa diff/blame entre tickets; `varrerBase` acrescenta alterações humanas. | É retrabalho textual de linhas, não prova de defeito. Reatribuir commits a rodada sem perder origem; a primeira varredura apenas estabelece cursor. |
| Exigências de revisão | `metricasDaIssue().exigenciasRevisao` conta tickets de desenvolvimento originados em revisão. | Não conta comentários ou achados individuais. Separar revisão da rodada de revisão integral. |
| Bugs em arquivos revisados | `metricasDaIssue().bugsEmArquivosRevisados` usa problemas posteriores ao merge com sobreposição de arquivos. | Proxy temporal por arquivos, sem atribuição causal comprovada à revisão. Não apresentar como defeitos necessariamente introduzidos pela rodada. |
| Rating | `notaPR` provém da aprovação do gate PR; `periodo.ts::metricasPorMes` calcula média e quantidade de notas. | No alvo, associar nota ao gate da rodada; não exigir nota no encerramento final automático. |
| Relatórios | `relatorio.ts::relatorio`, `periodo.ts::metricasPorMes/metricasPorIssue`. | Reaproveitar agregações e explicitar novos cortes; não confundir relatório com execução do ciclo de melhoria. |

## 9. Interfaces e consumidores

### 9.1 Contratos implementados afetados

| Contrato atual | Evidência no código | Adequação necessária |
| --- | --- | --- |
| CLI `ticket criar I-n` e parser de IDs `I/T` | `src/cli/cli.ts` | Endereçar demanda/ticket composto e rodada opcional; não tratar `N-n` das docs como API implementada. |
| Registro externo `necessidade ...` | `src/cli/cli.ts`, `src/dominio/gates.ts` | Receber definição completa, desenho/custos e identidade da origem; enviar para gate da demanda. |
| `POST /api/issues/:id/tickets` | `src/web/rotas/desenho.ts` | Separar planejamento, edição permitida e criação de correções por escopo. |
| `GET`/`POST /api/issues/:id/pr` | `src/web/rotas/pr.ts` | Distinguir PR da rodada de PR final; decisão humana aplica-se à rodada, não ao encerramento final. |
| Board com issue, `tickets` e `pr?` | `src/web/rotas/inicio.ts` | Exibir fase da demanda, rodadas e suas fases/PRs, bloqueios e trabalho global ativo. |
| Sessões/chat, execução agora, interrupção e reabertura | `src/execucao/sessoes.ts`, `src/execucao/servico.ts`, `src/web/rotas/chat.test.ts` | Preservar conversa e identificar ticket/rodada; mostrar falha parcial de integração/limpeza sem sugerir que nada foi integrado. |
| Prompts, skills e guarda do pi | `src/execucao/prompt.ts`, `src/execucao/pi.ts`, `pacote-pi/` | Fornecer novos escopos, etapas, IDs e permissões; bloquear implementação no ajuste de PR. |
| Métricas e relatórios | `src/metricas/` e consumidores web | Agrupar execução → sessão → ticket → rodada opcional → demanda → projeto, sem dupla contagem. |

Operações novas requeridas, independentemente da URL escolhida: consultar e submeter plano; criar/editar/remover rodadas e tickets onde permitido; decidir planejamento; consultar/decidir PR de rodada; acompanhar revisão integral; consultar e reabrir encerramento parcial. A exposição externa exata e compatibilidade dos comandos atuais dependem de D09.

As rotas `/api/.../entregas`, comandos `entrega ...` e estruturas `entregas[]` presentes em `fabriquinha/03-evidencias.md`, `06-metricas.md` e `07-interfaces.md` são contratos documentais antecipados, não endpoints encontrados no código. Precisam ser reconciliados com o vocabulário de rodadas sem criar uma segunda entidade equivalente.

### 9.2 Configuração e consumo

- Cadastro/edição de projeto deve expor linguagens por caminho, comandos de teste, E2E/globs, modelo e effort.
- Validação de modelo continua delegada ao harness; não acrescentar dependência ou catálogo de modelos apenas para esta alteração.
- Override de ticket e configuração de etapa não podem apagar silenciosamente um effort configurado ao resolver apenas o modelo; precedência em D07.
- Custos externos do entendimento/desenho e custos internos de execução devem ser discriminados, sem contar duas vezes valores informados e valores coletados. O ERD não fornece relação específica para o consumo externo; D03/D10 devem definir sua representação, sem fabricar execuções internas que não ocorreram.
- Não recontar execuções de sessões retomadas nem apresentar custo desconhecido como execução gratuita.

## 10. Persistência, migração e compatibilidade

### 10.1 Diferenças estruturais

O agregado implementado em `src/dominio/agregado.ts` contém issue, tickets, execuções, decisões e evidências; não contém rodadas. IDs são inteiros globais por tipo. Modelo de projeto e listas de configuração não equivalem às relações normalizadas do ERD. A migração deve alterar persistência, carregamento do agregado, comandos, consultas do agendador e consumidores conjuntamente.

Não reduzir o banco ao desenho removendo dados ainda utilizados: datas de criação/conclusão/arquivamento/cancelamento, erros, instrução de retomada, autoria/origem de tickets, associação à correção original, devoluções técnicas, commits, PRs, logs, processos, custos, métricas e propostas de issue e dados de simulação. Ausência desses campos no ERD não é decisão de descarte.


## 11. Escopo dos arquivos e contratos a alterar

| Área | Pontos atuais | Mudança técnica |
| --- | --- | --- |
| Tipos e regras | `src/dominio/primitivos.ts`, `agregado.ts`, `projeto.ts`, `issue.ts`, `tickets.ts`, `execucao.ts`, `gates.ts`, `conclusao.ts`, `evidencia.ts` | Identidades compostas, rodadas, novos estados, dependências e transições por escopo; origem externa e esforço. |
| Persistência | `src/persistencia/banco.ts`, `migracoes.ts`, `issues.ts`, `projetos.ts`, `servico.ts`, `commits.ts`, `execucoes.ts`, `arquivos.ts` | Schema/migração, carregamento/gravação, sessões, donos, vínculos de commits e seleção por rodada. |
| Aplicação/execução | `src/execucao/servico.ts`, `autonoma.ts`, `gerente.ts`, `sessoes.ts`, `prompt.ts`, `pi.ts`, `etapas/` | Sete contratos lógicos; planejamento, revisão integral, encerramento recuperável, effort e retomadas. |
| Evidências | `src/evidencias/coleta.ts`, `submissao.ts` e validadores específicos | Catálogo por etapa/dono, planos, referências a critérios, E2E e comprovações globais. |
| Git/hospedagem | `src/repositorio/worktree.ts`, `commit.ts`, `pr.ts` e adaptadores de hospedagem | Branch/worktree por rodada, PR contra demanda, integração final e recuperação de limpeza. |
| Interfaces | `src/cli/`, `src/web/`, `pacote-pi/` | IDs compostos, operações novas e remoção da suposição de um PR/fase de execução por issue. |
| Métricas/simulação | `src/metricas/`, `src/execucao/auditoria.ts` e fluxos de simulação | Agrupamento sem duplicação e adaptação dos consumidores dos enums/IDs alterados. |
| Contratos documentais | `00-visao-geral.md`, `fabriquinha/01-dominio.md` a `08-simulacao.md` | Reconciliar registro/desenho, entregas e rodadas; não manter três contratos incompatíveis. |
| Testes e fixtures | `src/**/*.test.ts`, `pacote-pi/**/*.test.ts`, `fitness/`, `integracao/`, `e2e/` | Adaptar contratos afetados e acrescentar cenários da seção 12. |

## 12. Critérios de aceite verificáveis

| ID | Cenário | Resultado esperado |
| --- | --- | --- |
| CA-SDLC-01 | Registrar externamente e enviar conteúdo incompleto/completo. | Pendências não congelam nem liberam gate válido; envio válido congela definição e registra origem. |
| CA-SDLC-02 | Aprovar/recusar demanda. | Aprovação disponibiliza planejamento; recusa encerra percurso por cancelamento, sem lançar desenho interno. |
| CA-SDLC-03 | Demanda com dependência pendente, inclusive de outro projeto. | Planejamento não inicia; ciclos e autorreferência são recusados. |
| CA-SDLC-04 | Planejamento reprovado e reenviado. | Mesma sessão é retomada; sem desenvolvimento antes da aprovação. |
| CA-SDLC-05 | Falha ao preparar aprovação do planejamento. | Gate continua aberto; nenhuma aprovação efetiva nem execução de rodada é registrada. |
| CA-SDLC-06 | Duas demandas com `rodada_id = 1` e `ticket_id = 1`. | Leitura, escrita, decisão e evidência não se cruzam; FKs recusam referências inválidas. |
| CA-SDLC-07 | Rodadas independentes e uma rodada dependente. | Independentes podem executar em paralelo; dependente aguarda conclusão; nunca dois tickets ativos na mesma rodada. |
| CA-SDLC-08 | Corrida entre agendador e executar agora. | Somente uma reserva/execução do trabalho elegível. |
| CA-SDLC-09 | Agente de implementação termina sem chamar submissão. | Aplicação verifica, coleta e commita quando aprovado; mera saída bem-sucedida não conclui trabalho inválido. |
| CA-SDLC-10 | Ticket falha, sofre timeout ou serviço reinicia. | Escopo bloqueado, histórico preservado, sem avanço automático; reabertura exige instrução e não executa imediatamente. |
| CA-SDLC-11 | Revisão da rodada reprovada. | Correções registradas retornam ao desenvolvimento e percorrem nova revisão/encerramento. |
| CA-SDLC-12 | PR de rodada com conflito/check falho ou reprovação humana. | Problema técnico gera correção antes de novo gate; reprovação humana abre conversa imediatamente e não modifica código nessa conversa. |
| CA-SDLC-13 | Aprovação solicitada e integração falha. | Rodada não é concluída e aprovação efetiva não é gravada; gate permanece aberto. |
| CA-SDLC-14 | Todas as rodadas integradas e revisão integral reprovada. | Novas rodadas corretivas percorrem ciclo completo; revisão integral se repete sobre resultado agregado. |
| CA-SDLC-15 | Revisão integral aprovada. | Encerramento final não solicita gate humano; conflito pode abrir agente, check falho bloqueia sem integração/limpeza. |
| CA-SDLC-16 | Queda após publicação/merge e antes da gravação. | Reconciliação reconhece efeito externo; repetição não duplica PR, integração ou decisão. |
| CA-SDLC-17 | Integração final confirmada e limpeza falha. | Demanda ainda não concluída; reabertura só repete limpeza, sem desfazer ou repetir merge. |
| CA-SDLC-18 | Evidência com ambos os donos preenchidos ou tipo duplicado. | Duplo dono é recusado; nova submissão substitui somente a evidência do mesmo tipo/dono. |
| CA-SDLC-19 | Critério citado inexistente e dependências entre tickets de rodadas distintas. | Operação recusada antes de congelar/executar plano. |
| CA-SDLC-20 | Sessão retomada e execução com múltiplos modelos/custo desconhecido. | Conversa reutilizada, tentativas distintas, uso agregado sem duplicação e desconhecido não convertido em zero. |
| CA-SDLC-21 | Configuração de modelo incompleta, effort inválido, E2E fora do intervalo e glob/caminho inválido. | Rejeição na fronteira; par de modelo conferido no harness; nenhum acesso fora do escopo autorizado. |
| CA-SDLC-22 | Migração de base com issues em fases distintas, anexos, sessões e PRs existentes. | Histórico e referências preservados; nenhum gate/merge fictício ou limpeza destrutiva. |
| CA-SDLC-23 | Cancelamento e arquivamento com dependentes/execuções. | Aplicação segue D08, interrompe somente escopos permitidos e não apaga histórico. |
| CA-SDLC-24 | Relatório da demanda com várias rodadas, revisões e custos externos. | Indicadores mantêm escopo e atribuição verificáveis; nenhum limiar vira gate sem contrato explícito. |
| CA-SDLC-25 | Avaliação de melhoria gera achado encaminhado pelo Auditor. | Escopo e matrizes são rastreáveis; demanda resultante entra no SDLC normal. Seleção das avaliações segue D12, sem fan-out obrigatório inferido. |

Reaproveitar testes existentes de CLI/rotas, desenvolvimento integrado, ordenação, retomada e recuperação. Acrescentar testes de domínio para transições/grafos, de persistência para FKs/índices/migração e de integração com SQLite/git reais e hospedagem/pi falsos. Validar as telas e o ciclo de correção/encerramento em E2E.

## 14. Referências de contrato

### 14.1 Draw.io

Arquivo: `ProcessoDeDesenvolvimento.drawio`, working tree, cinco páginas.

| Página | Elementos usados como referência |
| --- | --- |
| `Caminho da demanda` | Arestas `e1`–`e16`; nota de dependências; percurso do registro à conclusão e retorno da revisão integral. |
| `Executar as rodadas` | Arestas `e1`–`e14`; `implementar`, `sessao`, `nota`; implementação sequencial, revisão, PR, ajustes e paralelismo entre rodadas. |
| `Entidades` | Tabelas `projeto`, `erd_*`, `XcyZCd-SjGrCP0lY6zEm-1/32/98/79/54`; relações `erd_rel_1`–`erd_rel_26`; notas `regras_config`, `regras_relacionais`, `regras_documentos`, `regras_originais`. |
| `Sequência da demanda` | `texto_13`, `texto_26`, `texto_37/38/41/50/81/98/99/121–124`; mensagens `mensagem_125`–`mensagem_205` e fragmentos de alternativas/repetição. Aprovação condicionada, reabertura, serviços e encerramento recuperável. |
| `Page-1` | Visão detalhada das etapas, artefatos, métricas e melhoria; divergências de integração/paralelismo identificadas em D02/D04. |

### 14.2 Código e documentação existente

- `src/dominio/primitivos.ts`: enums/IDs atuais; `agregado.ts`: schemas de issue, ticket, execução, decisão e evidência; `projeto.ts`: configuração implementada.
- `src/dominio/execucao.ts`: início, exclusão por issue, modelo, reabertura e devoluções; `gates.ts`: registro, desenho, revisão e PR; `conclusao.ts`: transições e ciclos de correção; `evidencia.ts`: catálogo e substituição.
- `src/persistencia/migracoes.ts`: schema e migrações implementadas; `src/persistencia/issues.ts`: carregamento/gravação do agregado; `src/persistencia/servico.ts:43`: seleção de um ticket elegível por issue; `src/execucao/servico.ts:73`: recuperação após reinício.
- `src/execucao/autonoma.ts`: verificações posteriores e limite de devoluções; `gerente.ts`: execução pi e retomada de sessões; `sessoes.ts`: aprovação/ajustes de PR.
- `src/metricas/uso.ts`, `issue.ts`, `retrabalho.ts`, `periodo.ts`, `relatorio.ts`: indicadores e limites descritos na seção 8.4; `src/execucao/auditoria.ts` e `src/dominio/propostas.ts`: mecanismos distintos do ciclo de melhoria.
- `src/repositorio/worktree.ts:60`: branch/worktree por issue; `commit.ts:173` e `pr.ts:355`: recuperação específica de efeitos externos.
- `src/cli/cli.ts`, `src/web/rotas/desenho.ts`, `pr.ts`, `inicio.ts`: contratos públicos implementados.
- `src/execucao/desenvolvimento.test.ts`, `src/cli/cli.test.ts`, `src/web/rotas/desenho.test.ts`, `pr.test.ts`: testes de contratos/ciclos existentes usados na comparação; não constituem validação executada do modelo alvo.
- `fabriquinha/01-dominio.md`, `02-persistencia.md`, `03-evidencias.md`, `06-metricas.md`, `07-interfaces.md`: contratos documentais antecipados com entregas; não usados como prova de implementação.

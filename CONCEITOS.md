# Conceitos da Fabriquinha

Modelo dos conceitos principais do SDLC e especificação do que a Fabriquinha faz.
É a única fonte de verdade: o código e os testes seguem este documento, e o `AGENTS.md` traz as regras de codificação.
Cada conceito tem a definição, onde está no código, o que resolve e as decisões tomadas.
`TERMINOLOGIA.md` guarda, como registro histórico, os renomes que a refatoração aplicou.
`MAPA-CONCEITOS.md` mostra as relações entre os conceitos.

## 1. Trabalho Agêntico

Uso de um agente para produzir algo.
É a combinação de:

- **Modelo**: provedor + nome, com um **effort**.
- **Harness**: pi, Claude Code, Codex.
- **Instrução**: o prompt da etapa.
- **Capacidades**: skills, extensões, MCPs e CLIs.

Todo Trabalho Agêntico produz **Uso** (tokens e custo por modelo).
Pode também produzir **Evidências**.

### Variantes

- **Gerenciado**: a Fabriquinha lança, observa, retoma e encerra o processo.
  Modos: autônomo, interativo e consulta.
- **Não Gerenciado**: sessão externa, identificada por ferramenta + id da sessão.
  A Fabriquinha só recebe as evidências e o Uso declarados.

### Onde está no código

- `src/nucleo/trabalho_agentico.ts`: o Trabalho Gerenciado, o `ProcessoDoTrabalho`, o Trabalho Não Gerenciado e o `ModoTrabalho`.
- `src/aplicacao/trabalho/condutor.ts`: o condutor único, que lança o pi e consulta o modelo nos modos autônomo, interativo e consulta.
- `src/aplicacao/trabalho/processo_do_ticket.ts`: o processo do trabalho de um ticket.
- `src/infra/agente/harness_pi.ts`, `src/infra/agente/pi.ts` e `src/infra/agente/leitor_de_uso_pi.ts`: o harness pi e a leitura do Uso.
- `src/aplicacao/auditor_automatico.ts`: a chamada sem ferramentas, em modo consulta.
- `src/aplicacao/auditoria.ts`: a conversa da avaliação, pelo mesmo condutor.
- `src/armazenamento/trabalho_agentico.ts` e `src/armazenamento/uso_declarado.ts`: a persistência do Trabalho Gerenciado e do Uso declarado pelo Não Gerenciado.

### O que o conceito resolve

- Uma forma única de calcular Uso para as duas variantes.
- Um condutor único de processos do agente.
- "Sessão" nomeia só a conversa com o agente, e não mais uma etapa ou um estado.

### Decisões

- A chamada sem ferramentas (resumo do PR, auditor automático) é Trabalho Agêntico Gerenciado no modo consulta, com Uso medido.
- A simulação e a avaliação de melhoria ficaram fora destes conceitos, por decisão do usuário.
- A sessão de ajustes do PR é Trabalho Agêntico Gerenciado interativo, na Etapa "Ajustar Resultado".

## 2. Etapa

Passo do SDLC.
Toda Etapa tem:

- **Objetivo**: o que a etapa precisa alcançar.
- **Evidências**: o que comprova que a etapa foi cumprida.
- **Métricas de Sucesso**: como se mede se a etapa funciona bem.
- **Executor**: Trabalho Agêntico Gerenciado, Trabalho Agêntico Não Gerenciado ou a própria Fabriquinha (determinística, sem LLM).
- **Escopo**: Demanda ou Rodada.

| Etapa | Executor | Escopo |
|---|---|---|
| Entender e desenhar | Não Gerenciado | Demanda |
| Planejar | Gerenciado | Demanda |
| Implementar | Gerenciado | Rodada |
| Revisar rodada | Gerenciado | Rodada |
| Encerrar rodada | Gerenciado | Rodada |
| Revisar demanda | Gerenciado | Demanda |
| Encerrar demanda | Fabriquinha | Demanda |
| Resolver conflito | Gerenciado | Demanda |
| Ajustar Resultado | Gerenciado (interativo) | Rodada |

Os passos do encerramento (`check_final`, `integracao`, `limpeza`) são **passos** da Etapa, não Etapas.

### Onde está no código

- `src/nucleo/etapa.ts`: o catálogo único das Etapas, com objetivo, escopo, executor, produtor e regra de aprovação das Evidências.
- `src/aplicacao/etapas/conducao_de_etapa.ts`: o ciclo comum das etapas agênticas (preparar, rodar o agente, conferir Evidências, concluir ou falhar).
- `src/aplicacao/etapas/`: uma condução por Etapa (`conducao_de_implementar.ts`, `conducao_de_revisar_rodada.ts` e as demais) e o prompt de cada uma, em `.md`.
- `src/aplicacao/despacho.ts`: entrega o ticket reservado à condução da sua Etapa.
- `src/aplicacao/etapas/conducao_de_encerrar_demanda.ts`: os passos do encerramento da Demanda.

### O que o conceito resolve

- "Etapa" tem um único sentido.
- O estado de Demanda e Rodada é a Etapa corrente, mais os estados de espera e terminais (conceito 4).
- O ciclo das etapas agênticas fica num lugar só.

### Decisões

- "Resolver conflito" é uma Etapa própria (Executor agente, Evidências e Tentativas próprias); Encerrar demanda desvia para ela no conflito.
- "Ajustar Resultado" é uma Etapa, e não um desvio do gate do PR.
- "Ajustar Resultado" nasce do PR reprovado; o agente só registra tickets corretivos, sem mudar o código; a Evidência exigida são esses tickets.
- As Métricas de Sucesso são um conceito à parte (conceito 16), declarado pela Etapa.

## 3. Gate

Ponto em que o SDLC só avança depois de uma **Decisão**.
A Decisão registra o **Decisor**, o resultado (aprovar ou reprovar), a nota ou o motivo, o gate a que pertence e o caminho seguido: avanço ou retorno a uma etapa anterior.

### Decisores

- **Auditor (humano)**: demanda, planejamento e PR da rodada.
- **Agente (Trabalho Agêntico)**: revisão da rodada e revisão da demanda.
- **Fabriquinha (automático)**: testes, fitness, Sonar e conferência do PR; registra o resultado, sem Decisão.

### Onde está no código

- `src/nucleo/gate.ts`: os cinco gates (`GATES`), todos pelo mesmo caminho: validar a entrada, localizar o ticket âncora, montar a Decisão, aprovar ou reprovar.
- `src/nucleo/agregado_demanda.ts`: a Decisão, que guarda o gate a que pertence.
- `src/aplicacao/gates/decidir_gate.ts`: o único ponto de entrada que decide um gate, com os efeitos fora do agregado.
- `src/aplicacao/gates/planejamento.ts` e `src/aplicacao/gates/pr.ts`: os efeitos do gate do planejamento e do gate do PR.
- `src/aplicacao/gates/cancelamento_em_cascata.ts`: o cancelamento de uma Demanda reprovada.

### O que o conceito resolve

- Vocabulário único: aprovar / reprovar.
- A Decisão sabe de qual gate é.
- "Aguarda você" é derivado num lugar só, a partir dos gates humanos pendentes (mais falhas e diálogos).

### Decisões

- A reprovação técnica (testes/Sonar devolvem ao agente até 2 vezes) não é Gate: é a validação que a Etapa faz sobre a submissão (Verificação).
- Gate é só onde há Decisão registrada.
- "Integrar o PR final" não é Gate, pois não há Decisão registrada na Fabriquinha.
- O merge do PR final é do humano, na plataforma (ex.: Azure Repos pode exigir aprovação); é uma Pendência do tipo "Ação externa".
- Falhas e diálogos que aguardam o Auditor são Pendência (conceito 11).

## 4. Ciclo de Vida

Máquina de estados de um item de trabalho.
Tem o estado atual (com data/hora da mudança), as transições permitidas, os estados terminais (concluído, cancelado, arquivado) e os estados de espera (parado num Gate ou bloqueado por Dependência).
Vale para os três itens:

| Item | Estados | Exemplo |
|---|---|---|
| Demanda | `estado` | entender_e_desenhar → gate_demanda → planejar → gate_planejamento → em_execucao → revisar_demanda → encerrar_demanda → concluida |
| Rodada | `estado` | implementar → revisar_rodada → encerrar_rodada → gate_pr → ajustar_resultado → … → concluida |
| Ticket | `estado` | aberto → em_execucao → concluido / falhou / cancelado |

### Onde está no código

- `src/nucleo/ciclo_de_vida.ts`: a abstração única de estado, transição, terminal e dependência.
- `src/nucleo/ciclos.ts`: os três ciclos (`CICLO_DA_DEMANDA`, `CICLO_DA_RODADA`, `CICLO_DO_TICKET`) e o mapa de estado para Etapa.
- `src/nucleo/item_de_trabalho.ts`: o grafo de dependências sem ciclo, comum aos três itens.
- `src/nucleo/dependencia_demanda.ts`: as predecessoras pendentes de uma Demanda.

### O que o conceito resolve

- Uma abstração para estado, transição, terminal e dependência.
- Vocabulário único "estado".
- "Esperando o quê?" derivável de qualquer item.

### Decisões

- Cada Ticket executa exatamente uma Etapa (`ticket.etapa` é campo único).
- Não há estado de Demanda ou Rodada sem Etapa correspondente.
- A Demanda com Rodadas em andamento está **em execução**, como a Rodada e o Ticket.
- A composição é: Demanda = N Rodadas + K Tickets próprios; com M Tickets por Rodada, são M·N + K Tickets.
- `fechado` e `cancelado` do Ticket foram unificados em **cancelado**.
- A interrupção de um processo em andamento fica registrada na Tentativa.

## 5. Evidência

Input que uma Etapa pode exigir.
O Produtor submete dados e anexos; a Etapa valida (schema e regras) e aceita ou recusa, com motivo.
Só a submissão aceita vira Evidência; a recusada não existe como Evidência.

Atributos: tipo, dono (Demanda, Rodada ou Ticket), produtor (Trabalho Agêntico ou Fabriquinha), dados e anexos (por SHA-256).

### Onde está no código

- `src/nucleo/evidencia.ts`: a lista única de tipos e o schema de cada um (`dados`, anexos e regras cruzadas).
- `src/nucleo/evidencia_etapa.ts`: o que cada Etapa exige, quem produz e de que dono.
- `src/nucleo/evidencia_demanda.ts`: as Evidências obrigatórias da Demanda no envio.
- `src/aplicacao/evidencia/submeter.ts`: o caminho único de submissão; o Avaliador aceita ou recusa, e os anexos são guardados por SHA-256.
- `src/armazenamento/evidencia_demanda.ts`: a gravação das Evidências aceitas.
- `src/aplicacao/agente/adicionar_evidencia.ts`: a submissão feita pelo agente.

### O que o conceito resolve

- Se a Evidência existe, foi aceita: não há campo `aprovada`.
- A Etapa é a única dona da validação, num caminho único de submissão.
- Uma lista única de tipos, ligada às Etapas.
- O Gate decide só sobre Evidências aceitas.

### Decisões

- Resultado reprovado de testes, fitness ou Sonar é submissão recusada, com motivo; volta ao agente pela D05.
- Submissões recusadas ficam no histórico de Tentativas, com motivo, sem virar Evidência.
- As submissões recusadas alimentam a Métrica "exigências de alteração".
- O Uso de um Trabalho Gerenciado não é Evidência: é apenas Métrica (conceito 16), medida pela Fabriquinha.
- O Uso declarado pelo Não Gerenciado também é só Métrica, sem validação.

## 6. Tentativa e Falha

Uma Etapa executada por Trabalho Agêntico Gerenciado pode precisar de várias **Tentativas**.
Cada Tentativa termina em:

- **Sucesso**: as Evidências foram aceitas.
- **Reprovação**: problema do trabalho (testes, Sonar, hooks).
  Volta ao mesmo agente com o motivo, até o limite da regra (D05: 2 devoluções).
- **Falha de Infraestrutura**: problema do ambiente (timeout, cota, reinício, modelo sem resposta).
  A Fabriquinha retoma sozinha, podendo trocar de provedor, até um limite (3).

Esgotados os limites, o item fica **bloqueado** e aguarda o Auditor reabrir com uma instrução.

### Onde está no código

- `src/nucleo/tentativa.ts`: a Tentativa, o resultado tipado, a causa de infraestrutura, a política de limites (`POLITICA_DE_TENTATIVAS`) e o retorno ao agente.
- `src/aplicacao/retomada_infraestrutura.ts`: a retomada automática do ticket que falhou por infraestrutura, a cada ciclo do agendador.
- `src/aplicacao/fechamento_ticket.ts`: a falha do ticket em execução, de qualquer Etapa.
- `src/aplicacao/fotos_retorno/`: os textos de retorno ao agente (devolução e reabertura), conferidos pelos testes.

### O que o conceito resolve

- Falha vira tipo, e não texto.
- Limites e retomada numa regra única por classe de falha.
- Retorno ao agente num formato único.

### Decisões

- A reabertura pelo Auditor é nova Tentativa no mesmo Trabalho Agêntico (retoma a sessão), com os limites zerados.
- Exceção: plano aprovado e reaberto abre sessão nova.
- Etapas determinísticas (Encerrar demanda) seguem o mesmo modelo de Tentativa e Falha, com duas adaptações.
- Não há Reprovação nelas, pois não há agente a quem devolver: problema do trabalho vira desvio (conflito → Resolver conflito) ou bloqueio (check final falho).
- A Tentativa retoma pelo passo que falhou, sem refazer os que passaram.
- A recusa de submissão de Evidência (conceito 5) é exatamente a Reprovação: abre nova Tentativa e conta para o limite da D05.

## 7. Espaço de Trabalho

Lugar isolado onde o trabalho de um item acontece.
É composto por:

- **Branch**.
- **Worktree**.
- **Base**: de onde a branch parte.
- **Posse**: marca que a Fabriquinha criou o Espaço e responde por limpá-lo.
- **Ambiente**: local físico onde o Espaço roda (host local ou container).
  A Fabriquinha cria e elimina containers; eles formam um **Conjunto de Ambientes** compartilhado.
  Enquanto roda, o Ambiente é exclusivo de uma Rodada; ao terminar, é limpo e pode ser reutilizado por outra.

O Ambiente define onde rodam o Trabalho Agêntico Gerenciado (o processo do harness), a Preparação, as Verificações que executam código (testes, e2e, fitness) e as operações de git do Espaço.
Ficam fora do Ambiente o core da Fabriquinha (orquestração e banco), que o comanda, e o SonarQube, que é único e implantado junto com a Fabriquinha, no Docker.
O container não herda credenciais de hospedagem nem do SonarQube; o git que precisa delas roda no core.
Outras sandboxes (VM, por exemplo) seriam novos tipos de Ambiente.

Há dois níveis, em pastas irmãs, nunca aninhadas:

| Dono | Branch | Base | Pasta |
|---|---|---|---|
| Demanda | `fabriquinha/I-n` | `branch_base` do projeto | `<projeto>/<demanda>/demanda` |
| Rodada | `fabriquinha/I-n-m` | ponta da Demanda (D04) | `<projeto>/<demanda>/rodadas/<m>` |

Ciclo: **criar** (aloca um Ambiente, reutilizado ou novo, e roda a Preparação) → **atualizar com a base** → **integrar na base** → **limpar** (limpa o Ambiente e o devolve para reuso, ou o elimina).
A integração da Rodada na Demanda é um PR que a Fabriquinha integra; a da Demanda na base é o PR final; conflito vira o Trabalho "Resolver conflito".

### Onde está no código

- `src/nucleo/espaco_de_trabalho.ts`: o Espaço (branch, base, pasta), a única regra "com rodada usa o Espaço da rodada, senão o da demanda" e o PR do Espaço.
- `src/nucleo/demanda.ts`: os nomes das branches da Demanda e da Rodada.
- `src/aplicacao/espaco/ciclo_do_espaco.ts`: criar, atualizar com a base, integrar e limpar, num lugar só.
- `src/aplicacao/espaco/ambiente_do_servico.ts`: o Ambiente em que o serviço roda o Espaço.
- `src/infra/ambiente/ambiente.ts`: a interface do Ambiente, com `src/infra/ambiente/ambiente_host_local.ts` e `src/infra/ambiente/container/ambiente_container.ts`.
- `src/aplicacao/ambiente/conjunto.ts`: o Conjunto de Ambientes, que aloca, limpa, devolve e elimina os containers.
- `src/infra/ambiente/container/gerador_de_ambientes.ts`: o único que mexe nos containers.
- `src/armazenamento/ambientes.ts`: o banco que diz de quem é cada container.
- `src/infra/repositorio/worktree.ts`, `src/infra/repositorio/worktree-demanda.ts`, `src/infra/repositorio/pr.ts` e `src/infra/repositorio/limpeza_demanda.ts`: as operações de git e de hospedagem; a posse fica em `branch.<b>.fabriquinha`.
- `src/nucleo/projeto.ts`: a configuração do Ambiente (`ConfiguracaoDoAmbiente`: tipo, memória, CPUs e ociosidade para eliminar).

### O que o conceito resolve

- O Ticket pede "o meu Espaço" sem conhecer a regra.
- Um único Projeto.
- Ciclo criar/atualizar/integrar/limpar num lugar só.
- Ponto único para trocar o Ambiente.

### Decisões

- Cada Rodada roda no seu próprio Ambiente.
- O unificador é a hospedagem (GitHub ou Azure Repos): cada Rodada gera um PR na branch da Demanda.
- O Trabalho Agêntico Não Gerenciado não está sujeito ao Ambiente: a sessão externa roda onde o usuário quiser.
- O Sonar não roda no Ambiente nem no host: o SonarQube é único, implantado com a Fabriquinha no Docker.
- O Ticket de Planejar trabalha no Espaço da Demanda.
- A Integração é um passo do ciclo do Espaço; muda só quem integra (Rodada: a Fabriquinha; Demanda: o humano na plataforma).
- Avaliação e Simulação ficaram fora destes conceitos, por decisão do usuário.

## 8. Uso

Consumo de um Trabalho Agêntico, por Modelo: tokens (entrada, saída, cache) e custo.
Custo ausente é **desconhecido**, não zero (D10).

É agregável em qualquer nível: Trabalho → Ticket → Rodada → Demanda → Projeto → período, e também por Etapa.
Alimenta a métrica "tokens/modelo e custo total" que toda Etapa do SDLC exige.

A origem depende da variante:

- **Gerenciado**: a Fabriquinha mede, lendo o JSONL do pi na janela da execução.
- **Não Gerenciado**: o produtor declara, sem validação; sessão repetida em outra demanda conta uma vez.

### Onde está no código

- `src/nucleo/uso.ts`: o tipo único de Uso (`LinhaDeUso`), a soma e o texto do custo.
- `src/nucleo/trabalho_agentico.ts`: o Uso por modelo de cada Trabalho Gerenciado.
- `src/infra/agente/leitor_de_uso_pi.ts`: a medição do Uso do pi.
- `src/armazenamento/uso_declarado.ts`: o Uso declarado pelo Não Gerenciado.
- `src/aplicacao/metricas/metrica_de_uso.ts`: a Métrica de Uso, agregada por Etapa, Demanda, Projeto e período.

### O que o conceito resolve

- Um tipo e uma soma únicos.
- Toda variante de Trabalho Agêntico tem Uso, visível em todas as telas.

### Decisões

- Custo desconhecido aparece como soma do conhecido com "≥" e aviso (ex.: "≥ US$ 4,20 (2 sessões sem custo)").
- O Uso de Avaliação e Simulação ficou fora destes conceitos, por decisão do usuário.
- O Uso de "Ajustar Resultado" conta para a Rodada.

## 9. Despacho

Regra determinística que escolhe qual trabalho roda agora.
Quem escolhe é sempre a Fabriquinha, nunca o agente.

A cada ciclo:

1. **Seleciona** os itens prontos: Ciclo de Vida numa Etapa executável, sem Dependência pendente e sem Gate aguardando.
2. **Ordena** por prioridade: demanda de menor número, depois rodada, depois ticket.
3. **Respeita** o limite de paralelismo global e configurável.
4. **Reserva** o item e o entrega ao Executor da Etapa.

### Onde está no código

- `src/nucleo/despacho.ts`: a regra única do que roda agora, com o motivo tipado de cada recusa.
- `src/nucleo/reserva_ticket.ts`: a reserva do ticket (aberto → em execução), só se o Despacho o seleciona.
- `src/aplicacao/despacho.ts`: o ciclo do agendador e o "Executar agora"; reserva e cria a execução na mesma transação e entrega à condução da Etapa.
- `src/armazenamento/despacho_demanda.ts`: a gravação das execuções do Despacho.
- `src/entrega/contrato/despacho.ts`: o que o Despacho mostra às telas, inclusive as recusas.

### O que o conceito resolve

- O Despacho pergunta à Etapa quem a executa.
- Pronto, ocupado e bloqueado derivam do Ciclo de Vida e da Dependência, num lugar só.
- Toda recusa tem motivo tipado e exibível.

### Decisões

- "Executar agora" respeita o limite de paralelismo.
- A retomada automática por Falha de Infraestrutura passa pelo Despacho: reabre o ticket dentro do ciclo, e a seleção normal escolhe.
- O limite de paralelismo não considera o Ambiente por enquanto.

## 10. Plano

Decomposição de uma Demanda em Rodadas e Tickets, produzida pela Etapa Planejar e aprovada no Gate do planejamento.
Contém:

- **Rodadas**: cada uma vira 1 PR, com dependências, e2e e critérios de aceite citados (CA-n).
- **Tickets** de implementação por Rodada, com dependências e modelo/effort opcionais.
- **Arquivos previstos** em três níveis: Demanda, Rodada e Ticket.
  Ticket ⊆ Rodada ⊆ Demanda: um Ticket não prevê arquivo fora da sua Rodada, nem a Rodada fora da Demanda; prever fora exige correção do Plano.

O Plano tem **versões**:

1. **Proposto**: Evidência submetida pelo planejador.
2. **Versão 1**: após o Gate aprovado, vira Rodadas e Tickets reais, cada um com seu Ciclo de Vida.
3. **Correções**: cada mudança de rumo é uma nova versão, com origem (revisão da rodada, revisão da demanda, Ajustar Resultado ou conferência do PR) e autor.

O Plano aprovado original (versão 1) é a referência fixa da **Conformidade**: Jaccard entre arquivos previstos e alterados, com correções contando como extras.

### Onde está no código

- `src/nucleo/plano.ts`: o Plano proposto, as versões, as correções e o único caminho que cria Rodadas e Tickets a partir de uma versão (`materializar`).
- `src/nucleo/transicoes_demanda.ts` e `src/nucleo/transicoes_rodada.ts`: as transições que aprovam o Plano e aplicam as correções.
- `src/nucleo/cancelamento_demanda.ts`: o cancelamento de uma Demanda com seu Plano.
- `src/aplicacao/agente/criar_ticket_corretivo.ts`: o agente propõe os tickets corretivos.
- `src/aplicacao/metricas/metrica_de_conformidade.ts`: a Conformidade como Métrica visível.

### O que o conceito resolve

- O Plano tem identidade, com o original e suas correções como versões.
- Materialização por um caminho só.
- Conformidade como métrica visível.

### Decisões

- Tickets corretivos são correção do Plano, qualquer que seja a origem, e contam como extras na Conformidade.
- Não existe replanejamento: mudança de rumo é sempre correção do Plano.
- Os arquivos previstos existem nos três níveis (Ticket ⊆ Rodada ⊆ Demanda).

## 11. Pendência

Tudo o que está parado esperando o Auditor.
É sempre derivada do estado dos outros conceitos, nunca gravada.
Tipos:

- **Gate humano aberto**: demanda, planejamento ou PR da rodada aguardando Decisão.
- **Item bloqueado**: Tentativas esgotadas; precisa de reabertura com instrução.
- **Diálogo do agente**: Trabalho Agêntico interativo aguardando resposta.
- **Revisão parada**: todas as Rodadas concluídas e a revisão integral da Demanda não abriu dentro da tolerância.
- **Ação externa**: o Auditor precisa agir fora da Fabriquinha (ex.: merge do PR final na plataforma).
- **Despacho parado**: ticket aberto e elegível com o agendador desligado; o Auditor executa.

Cada Pendência tem item (`I-n`, `I-n.Rm`, `I-n.Tm`), motivo tipado e ação esperada.
Esperar uma Dependência ("aguarda I-x") **não** é Pendência: ninguém precisa agir.

### Onde está no código

- `src/nucleo/pendencia.ts`: a única regra que decide o que aguarda o Auditor (`pendenciasDaDemanda`).
- `src/aplicacao/consultas/pendencias.ts`: as Pendências como as telas as mostram.
- `src/aplicacao/consultas/inicio.ts`: o Início e o contador da navegação, pela mesma consulta.
- `src/aplicacao/consultas/bloqueios.ts`: os itens bloqueados.
- `src/entrega/http/rotas/inicio.ts`: a rota do Início.
- `src/entrega/cliente-web/telas/inicio.ts`, `src/entrega/cliente-web/telas/demandas.ts`, `src/entrega/cliente-web/telas/projeto.ts` e `src/entrega/cliente-web/telas/chat.ts`: as telas que mostram a mesma Pendência.

### O que o conceito resolve

- Regra única; Início, board, projeto, chat e contador da navegação mostram o mesmo.

### Decisões

- "Ajustar Resultado" aguardando o Auditor é Pendência do tipo Diálogo.
- "Integrar o PR final" é Pendência do tipo **Ação externa**: o humano age fora da Fabriquinha, que acompanha o PR na plataforma.
- A Pendência carrega o "desde" (derivado do Ciclo de Vida); exibi-lo é decisão de UI.

## 12. Verificação

Checagem determinística que a Fabriquinha roda sobre o Espaço de Trabalho.
Testes, e2e e fitness rodam dentro do Ambiente; o Sonar roda no SonarQube único da Fabriquinha.
O resultado vira submissão de Evidência para a Etapa.
Tipos, vindos da configuração do Projeto:

- **Testes por linguagem**: comando de teste por caminho.
- **E2E**: build, execução e `codigo_falha` (D07); saída 0 passa, `codigo_falha` é Reprovação, outro código é Falha de Infraestrutura.
- **Fitness functions**: nome, comando e descrição.
- **Sonar**: quality gate do projeto.
- **Hooks do commit**: rodam no commit que a Fabriquinha faz; mesmas classes de resultado, sem gerar Evidência.
- **Conferência do PR**: check falho ou conflito na plataforma, na Etapa Encerrar rodada; a recusa gera tickets corretivos como correção do Plano.

Toda Verificação termina em **passou**, **Reprovação** ou **Falha de Infraestrutura**, as mesmas classes da Tentativa.

### Onde está no código

- `src/nucleo/verificacao.ts`: a classificação única da saída de um comando de Verificação.
- `src/infra/verificacao/verificacao.ts`: a Verificação e o registro do resultado, com o conjunto declarado por Etapa.
- `src/infra/verificacao/testes.ts`, `src/infra/verificacao/e2e.ts`, `src/infra/verificacao/fitness.ts` e `src/infra/verificacao/sonar.ts`: os tipos de Verificação.
- `src/infra/verificacao/hooks_do_commit.ts`: os hooks do commit.
- `src/infra/verificacao/conferencia_do_pr.ts`: a conferência do PR.
- `src/aplicacao/evidencias/verificacoes.ts`: a coleta das Verificações de um ticket, sem banco.

### O que o conceito resolve

- Conjunto de Verificações declarado por Etapa (ex.: Implementar exige testes + Sonar; Revisar exige fitness).
- Classificação única.
- Testes, e2e e fitness executados no Ambiente do Espaço de Trabalho.

### Decisões

- A Fabriquinha faz o commit do ticket com os hooks do repositório, dentro do Ambiente, sem pular hooks e sem credenciais.
- Falha do hook é Reprovação (D05); hook travado é Falha de Infraestrutura.
- O hook segue as mesmas classes de resultado das Verificações, mas não gera Evidência.
- A conferência do PR é Verificação da Etapa Encerrar rodada.
- A Preparação não é Verificação: é o passo "criar" do Espaço de Trabalho (conceito 7).

## 13. Projeto

Repositório que a Fabriquinha opera, mais a configuração de como cada Etapa trabalha nele.

- **Identidade**: nome, `raiz_git`, `branch_base`, hospedagem e chave do Sonar.
- **Configuração por Etapa**: modelo e effort, resolvidos pela D07 (ticket ?? etapa do projeto ?? padrão do harness).
- **Verificações**: preparação, linguagens/testes, e2e/globs e fitness.
- **Ambiente**: tipo, memória, CPUs e ociosidade para eliminar.

### Onde está no código

- `src/nucleo/projeto.ts`: o único Projeto (`raiz_git`, `branch_base`), a Hospedagem e a configuração do Ambiente.
- `src/nucleo/configuracao_agente.ts`: o par modelo + effort (`ConfiguracaoAgente`) e a D07 numa única função (`resolverConfiguracaoAgente`).
- `src/aplicacao/projeto/cadastro.ts`: o cadastro do Projeto, com as conferências externas.
- `src/aplicacao/projeto/modelo_effort.ts`: o modelo e o effort de cada Etapa do Projeto.
- `src/armazenamento/projetos.ts` e `src/armazenamento/configuracao_agente.ts`: a persistência.
- `src/aplicacao/configuracao/configuracao_do_ambiente.ts`: a validação e a gravação da configuração do Ambiente.

### O que o conceito resolve

- Um único Projeto, com vocabulário único.
- Modelo + effort é um valor único ("Configuração do Agente"), reutilizado no Trabalho Agêntico, no Ticket e na Etapa.
- A D07 numa única função de resolução.

### Decisões

- O Ambiente é gerenciado pela Fabriquinha, que cria e elimina containers compartilhados entre Rodadas.
- Terminada uma Rodada, o container é limpo e reutilizado por outra.
- As Capacidades (skills, MCPs) são fixas por Etapa, no código.
- O cursor de commits humanos é das Métricas, como estado interno da leitura dos commits humanos posteriores.

## 14. Item de Trabalho

Os três níveis em que o SDLC divide o trabalho.
Cada um tem Ciclo de Vida, Dependências e um **Endereço**.

| Item | Endereço | O que é | Fecha com |
|---|---|---|---|
| Demanda | `I-n` | Necessidade enviada pronta: critérios de aceite, desenho e Uso externo | PR final integrado na base |
| Rodada | `I-n.Rm` | Fatia da Demanda que vira 1 PR | PR integrado na branch da Demanda |
| Ticket | `I-n.Tm` | Execução de uma Etapa | Evidências aceitas |

Cada Ticket executa uma Etapa, e a Etapa define o escopo.
Implementar, Revisar rodada e Encerrar rodada pertencem a uma Rodada.
Planejar, Revisar demanda e Resolver conflito pertencem só à Demanda.

### Onde está no código

- `src/nucleo/item_de_trabalho.ts`: o endereço, o grafo de dependências, o ticket atual da Etapa e a fábrica de ticket.
- `src/nucleo/demanda.ts`: os identificadores e a formatação dos endereços.
- `src/nucleo/agregado_demanda.ts`: o agregado da Demanda, com Rodadas, Tickets, Evidências, Decisões e PRs.
- `src/nucleo/primitivos.ts`: os estados e as Etapas como tipos.
- `src/armazenamento/demandas.ts`: a gravação do agregado.
- `src/aplicacao/gestao_demandas.ts`: os casos de uso que criam e alteram Demandas.
- `src/entrega/contrato/demanda.ts`: o formato da Demanda nas rotas e telas.

### O que o conceito resolve

- "Ticket atual da Etapa" é uma consulta só.
- Um vocabulário único para os três itens: estado, Etapa, Endereço.

### Decisões

- O envio externo da Demanda é um Ticket da Etapa "Entender e desenhar", executado pelo Ator Externo.
- A Evidência do envio tem esse Ticket como dono.
- Mantém-se o escopo duplo das Etapas; Rodada é sempre 1 PR, e Planejar e Revisar demanda não geram PR.
- O PR é atributo do Espaço de Trabalho (Rodada e Demanda): número, URL, head e estado, preenchido no passo integrar.
- A Evidência "PR publicado" continua comprovando a Etapa Encerrar rodada, mas o estado atual do PR fica num lugar só (`src/nucleo/espaco_de_trabalho.ts`).

## 15. Ator

Quem age no SDLC.
Os mesmos quatro Atores aparecem como Decisor (Gate), Produtor (Evidência) e Executor (Etapa).

| Ator | Quem é | Identidade |
|---|---|---|
| Auditor | O humano | — |
| Agente | Trabalho Agêntico Gerenciado | o Trabalho (sessão) |
| Externo | Trabalho Agêntico Não Gerenciado | ferramenta + id da sessão |
| Fabriquinha | O sistema, sem LLM | — |

Todo registro de "quem fez" (decisão, evidência, transição, ticket criado) aponta para um Ator.

### Onde está no código

- `src/nucleo/ator.ts`: o único tipo de autoria (`Ator`), com `AUDITOR`, `FABRIQUINHA` e a checagem de quem pode agir (`exigirAtor`).
- `src/entrega/cli/demanda_externa.ts`: o envio da Demanda pela ferramenta externa, que informa ferramenta e sessão.
- `src/entrega/http/agente/autenticacao.ts`: a identificação do agente nas rotas do agente.

### O que o conceito resolve

- Um único tipo Ator, com identidade, em todos os papéis.
- "Criado por" (o Ator) deixa de ser sinônimo de "origem" da Demanda.

### Decisões

- O auditor automático (triagem por LLM das perguntas do agente) é Agente; o registro mostra que a resposta veio de um agente, não do Auditor.
- Não há mais de um Auditor humano: o Auditor segue sem identidade.
- Tickets corretivos criados a partir de uma revisão têm como autor o Agente revisor, que decide o que corrigir; a Fabriquinha só materializa.

## 16. Métrica

Medida de quão bem uma Etapa cumpre seu Objetivo (as "Métricas de Sucesso" do SDLC).
É declarada pela Etapa e derivada do que os outros conceitos já registram, nunca gravada à parte.

| Etapa | Métricas | Deriva de |
|---|---|---|
| Todas | tokens/modelo e custo | Uso |
| Entender e desenhar | aprovações/reprovações | Gate da demanda |
| Planejar | conformidade do PR com o plano | Plano × arquivos alterados |
| Implementar | alterações posteriores no código | Commits humanos posteriores na base |
| Revisar rodada/demanda | exigências de alteração; bugs nos arquivos revisados | Decisões de reprovação; commits humanos posteriores na base |
| Encerrar rodada | nota humana (1–5) | Gate do PR |

Agregável por período, Projeto e Demanda.

### Onde está no código

- `src/nucleo/metrica.ts`: os tipos de Métrica de Sucesso que as Etapas declaram.
- `src/nucleo/etapa.ts`: as Métricas de cada Etapa, no catálogo.
- `src/aplicacao/metricas/calculo_de_metrica.ts`: o contrato de cálculo comum às Métricas.
- `src/aplicacao/metricas/metricas_das_etapas.ts`: cada Etapa com suas Métricas, para a tela de Métricas e a avaliação.
- `src/aplicacao/metricas/metricas_do_periodo.ts`: a agregação por período.
- `src/aplicacao/metricas/metrica_de_uso.ts`, `src/aplicacao/metricas/metrica_de_conformidade.ts`, `src/aplicacao/metricas/metrica_de_aprovacoes_e_reprovacoes.ts`, `src/aplicacao/metricas/metrica_de_alteracoes_posteriores.ts`, `src/aplicacao/metricas/metrica_de_exigencias_de_alteracao.ts`, `src/aplicacao/metricas/metrica_de_bugs_nos_arquivos_revisados.ts` e `src/aplicacao/metricas/metrica_de_nota_humana.ts`: uma classe por Métrica.
- `src/aplicacao/metricas/varrer_commits_humanos.ts`: a leitura dos commits humanos posteriores, que guarda o cursor.
- `src/entrega/cliente-web/telas/metricas.ts`: a tela de Métricas, "cada Etapa × suas Métricas de Sucesso".

### O que o conceito resolve

- A tela de Métricas é "cada Etapa × suas Métricas de Sucesso", como no SDLC.
- Vocabulário alinhado aos conceitos (Reprovação, Gate).

### Decisões

- Retrabalho não é conceito: as Métricas citam diretamente sua fonte (commits humanos posteriores na base).
- A Métrica tem só medição, sem meta, por enquanto.

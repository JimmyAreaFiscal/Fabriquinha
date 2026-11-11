# Mapa dos Conceitos da Fabriquinha

Relações entre os conceitos de `CONCEITOS.md`.

```mermaid
flowchart LR
  Projeto -->|1:N| Demanda
  Demanda -->|1:N| Rodada
  Demanda -->|1:N tickets próprios| Ticket
  Rodada -->|1:N| Ticket
  Plano -->|materializa| Rodada
  Plano -->|materializa| Ticket
  Demanda -->|tem| Plano
  Plano -->|1:N| VersaoDoPlano[Versão do Plano]
  Gate -->|aprovado gera a versão 1| VersaoDoPlano
  Correcao[Correção] -->|gera nova versão| VersaoDoPlano

  Ticket -->|executa 1| Etapa
  Etapa -->|executor| Ator
  Etapa -->|exige| Evidencia
  Etapa -->|roda| Verificacao
  Etapa -->|declara| Metrica
  Etapa -->|seguida de| Gate
  Gate -->|registra| Decisao
  Decisao -->|decisor| Ator

  Ticket -->|1:N| Tentativa
  Tentativa -->|no| TrabalhoAgentico
  TrabalhoAgentico -->|1:N| ProcessoDoTrabalho
  TrabalhoAgentico -->|produz| Uso
  Uso -->|alimenta| Metrica
  Verificacao -->|aceita/recusa| Evidencia

  Demanda -->|tem| Espaco[Espaço de Trabalho]
  Rodada -->|tem| Espaco
  Espaco -->|aloca| Ambiente
  ConjuntoDeAmbientes[Conjunto de Ambientes] -->|1:N| Ambiente
  Espaco -->|pede ao| ConjuntoDeAmbientes
  Espaco -->|tem| PR
  TrabalhoAgentico -->|roda no| Ambiente

  Despacho -->|seleciona Ticket pronto| Ticket
  CicloDeVida[Ciclo de Vida] -.->|rege| Demanda & Rodada & Ticket
  Pendencia -.->|deriva de| Gate & Tentativa & TrabalhoAgentico & PR
```

## Como ler

- **Estrutura**: Projeto → Demanda → Rodada → Ticket; o Plano materializa Rodadas e Tickets.
- **Plano**: tem versões; a aprovação do planejamento gera a versão 1, e cada Correção (revisão, Ajustar Resultado ou conferência do PR) gera uma nova.
- **Trabalho**: o Ticket executa uma Etapa, que define Executor (Ator), Evidências exigidas, Verificações, Métricas e o Gate seguinte.
- **Execução**: o Ticket faz Tentativas num Trabalho Agêntico, que roda em Processos no Ambiente do Espaço de Trabalho.
- **Ambiente**: o Espaço de Trabalho pede um Ambiente ao Conjunto de Ambientes, que o aloca, limpa e reutiliza ou elimina.
- **Verificação**: a Etapa roda Verificações no Ambiente (testes, e2e, fitness, Sonar, hooks do commit e conferência do PR); o resultado é aceito ou recusado como Evidência.
- **Tracejado**: conceitos que só regem ou derivam; o Ciclo de Vida rege os Itens de Trabalho, e a Pendência é calculada, nunca gravada.

O Trabalho Não Gerenciado aparece só como Ator Externo e fonte de Uso: não roda no Ambiente nem tem Processo.

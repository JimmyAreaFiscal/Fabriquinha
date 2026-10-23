# F3 — Evidências

Sistema: Fabriquinha.
Depende de: F1 (catálogo, C17), F2 (arquivos, transações), F5 (diff e worktree), F6 (relatório de produtividade).
Usado por: F4 (coleta antes e depois do pi) e F7 (submissão pelo agente, exibição no web).

## 1. Responsabilidade

- Definir o conteúdo de cada tipo de evidência: o schema de `dados` e as regras dos arquivos.
- Validar o que o agente submete antes de gravar, com mensagens que dizem o que corrigir.
- Produzir as evidências verificáveis por máquina (princípio 2 da visão geral): testes, SonarQube, arquivos alterados e fitness functions.
- Registrar as evidências que outros módulos produzem: relatório de produtividade (F6) e PR aberto (F5).
- Publicar o JSON Schema de cada tipo, para a skill e o agente saberem o formato exato (Feedback.txt, item 1).

O catálogo (que tipo pertence a que etapa, quem produz, o que é obrigatório) é regra do F1.
Este módulo implementa o conteúdo.

## 2. Tipos de evidência

São 21 tipos.
`explicacao_fitness` separa o que o agente escreve do que a Fabriquinha mede, para que cada tipo tenha um produtor só.
Na tela, ela aparece junto com `matriz_fitness`, formando a "matriz de fitness functions com explicações" do diagrama.

| Etapa | Tipo | Produtor | `aprovada` |
|---|---|---|---|
| demanda | `comportamento` | externo | — |
| demanda | `criterios_aceite` | externo | — |
| demanda | `desenho_solucao` | externo | — |
| demanda | `prototipo` | externo | — |
| demanda | `relatorio_complexidade` | externo | — |
| demanda | `relatorio_impactos_arquitetura` | externo | — |
| demanda | `custos_realizados` | externo | — |
| planejamento | `arvore_planejamento` | fabriquinha | — |
| desenvolvimento | `execucao_testes` | fabriquinha | todos os comandos saíram com 0 |
| desenvolvimento | `matriz_fitness` | fabriquinha | todas as fitness functions passaram |
| desenvolvimento | `relatorio_sonar` | fabriquinha | zero issue aberta nos arquivos alterados |
| revisao | `arquivos_alterados` | fabriquinha | — |
| revisao | `matriz_fitness` | fabriquinha | todas as fitness functions passaram |
| revisao | `explicacao_fitness` | agente | — |
| revisao | `comprovacao_criterios` | agente | todos os critérios da entrega atendidos |
| encerramento | `mensagem_pr` | agente | — |
| encerramento | `aula_codigo` | agente | — |
| encerramento | `video_demonstracao` | agente | — |
| encerramento | `relatorio_produtividade` | fabriquinha | — |
| encerramento | `pr_aberto` | fabriquinha | — |
| revisao_demanda | `comprovacao_criterios` | agente | todos os critérios da demanda atendidos |
| encerramento_demanda | `arvore_prs_criterios_custos` | fabriquinha | — |
| encerramento_demanda | `demonstracao_limpeza` | fabriquinha | nada sobrou |

`aprovada` é sempre calculada pelo F3 a partir do conteúdo; ninguém a declara.

## 3. Arquivos

### 3.1 Classes de arquivo

O tipo do arquivo é detectado pelos primeiros bytes, nunca pela extensão.

| Classe | Formatos aceitos | Assinatura | Limite |
|---|---|---|---|
| `video` | WebM, MP4 | `1A 45 DF A3`; `ftyp` no byte 4 | 500 MiB |
| `imagem` | PNG, JPEG | `89 50 4E 47`; `FF D8 FF` | 20 MiB |
| `html` | documento HTML autocontido | UTF-8 válido, sem byte nulo, começando por `<!doctype html` ou `<html` (ignorando BOM e espaços) | 5 MiB |
| `texto` | qualquer outro texto (código, Markdown, log) | UTF-8 válido e sem byte nulo | 5 MiB |

ponytail: os limites são constantes no código; viram configuração quando algum projeto precisar de outro valor.

### 3.2 De onde o agente pode anexar

- Da worktree da issue ou do diretório de saída da execução (`$FABRIQUINHA_SAIDA`, criado pelo F4 em `execucoes/E-<n>/saida/`).
- O caminho é resolvido com `realpath` antes da checagem, então link simbólico não escapa desses dois diretórios.
- Só arquivo regular.

O diretório de saída existe para que vídeos e prints não sujem o repositório.

### 3.3 Formato por finalidade

| Finalidade | Formato |
|---|---|
| Explicação para o humano (Auditor, revisor do PR) | HTML |
| Passagem de contexto entre agentes (descrição de issue e ticket, resumo) | Markdown ou texto |
| Dado que a máquina confere ou mede | JSON em `dados` |

O documento HTML precisa ser autocontido: CSS e SVG embutidos, imagens como `data:` URI.
Assim ele abre igual no web, num download ou anexado a outro lugar.

O web nunca injeta HTML do agente na própria página.
Ele exibe o documento num `iframe` com `sandbox="allow-scripts"` (sem `allow-same-origin`) e serve o arquivo com `Content-Security-Policy: sandbox allow-scripts`.
Um script do agente roda numa origem opaca e não alcança o token nem as rotas de gate do web (D9).

## 4. Schemas de `dados`

Trechos em `zod`, no mesmo estilo do F1.
`Arquivos(...)` descreve os arquivos anexados na submissão; o nome original de cada um é o que o `dados` referencia.

### 4.1 Demanda

```ts
// comportamento — "vídeo / código do comportamento atual e/ou do problema"
dados: z.object({
  descricao: z.string().trim().min(1).max(2000),
  comoReproduzir: z.array(z.string().trim().min(1)).min(1),
}),
arquivos: Arquivos({ classes: ["video", "texto"], min: 1 }),

// criterios_aceite
dados: z.object({
  criterios: z.array(z.object({
    id: z.string().regex(/^CA-\d+$/),
    dado: z.string().trim().min(1),
    quando: z.string().trim().min(1),
    entao: z.string().trim().min(1),
  })).min(1).refine(unicoPor("id"), "id de critério repetido"),
}),
arquivos: Arquivos({ max: 0 }),
```

```ts
// desenho_solucao — o HTML explica a solução ao Auditor; dados guarda o que a máquina confere
dados: z.object({
  resumo: z.string().trim().min(1).max(2000),   // contexto para os agentes das próximas etapas
  arquivosPrevistos: z.array(z.object({
    caminho: CaminhoRelativo,          // aceita glob; sem "..", sem caminho absoluto
    acao: z.enum(["criar", "alterar", "remover"]),
    motivo: z.string().trim().min(1).max(2000),     // autonomia do agente para justificar
  })).min(1),
  foraDeEscopo: z.array(z.string().trim().min(1)).default([]),
}),
arquivos: Arquivos({ classes: ["html"], min: 1, max: 1 }),   // o desenho, com diagramas embutidos

// prototipo — obrigatório só quando a issue é funcionalidade (catálogo do F1)
dados: z.object({
  descricao: z.string().trim().min(1).max(2000),
  comoExecutar: z.string().trim().max(2000).optional(),
}),
arquivos: Arquivos({ classes: ["video", "imagem", "html", "texto"], min: 1 })
  .refine(temClasse("video", "imagem"), "protótipo precisa de pelo menos um vídeo ou print"),

// relatorio_complexidade — complexidade algorítmica (tempo e espaço) de cada fluxo da solução
const Complexidade = z.object({ tempo: BigO, espaco: BigO });
dados: z.object({
  variaveis: z.array(z.object({
    simbolo: z.string().regex(/^[a-z][a-z0-9_]{0,15}$/).refine((s) => s !== "log", "log é reservado"),
    significado: z.string().trim().min(1).max(300),
  })),
  fluxos: z.array(z.object({
    nome: Titulo,
    gatilho: z.string().trim().min(1).max(300),   // o que inicia o fluxo: rota, comando, job, evento
    situacao: z.enum(["novo", "alterado"]),
    antes: Complexidade.optional(),              // obrigatório se e somente se situacao = alterado
    depois: Complexidade,
  })),
}),
arquivos: Arquivos({ classes: ["html"], min: 1, max: 1 }),   // as etapas de cada fluxo, do gatilho ao fim

// relatorio_impactos_arquitetura — o que a solução muda na arquitetura
dados: z.object({
  impacto: z.enum(["baixo", "medio", "alto"]),
  novasDependencias: z.array(z.object({ nome: z.string().trim().min(1), motivo: z.string().trim().min(1).max(2000) })),
  novosAcoplamentos: z.array(z.object({ de: z.string().trim().min(1), para: z.string().trim().min(1), motivo: z.string().trim().min(1).max(2000) })),
  riscos: z.array(z.object({ descricao: z.string().trim().min(1).max(2000), mitigacao: z.string().trim().min(1).max(2000) })),
}),
arquivos: Arquivos({ classes: ["html"], min: 1, max: 1 }),
```

#### Padrão de registro da complexidade

O relatório registra o **total** de cada fluxo em notação Big-O; as etapas do início ao fim ficam no HTML, que explica cada fluxo com o mesmo `nome` do JSON.

| Regra | |
|---|---|
| Caso | Sempre o pior caso. |
| Espaço | Espaço auxiliar: o que a solução aloca além da entrada. |
| Fluxos | Um para cada caminho que a solução cria (`novo`) ou altera (`alterado`): uma rota, um comando, um job, um evento. |
| Antes e depois | Fluxo `alterado` registra a complexidade de antes e a de depois; fluxo `novo`, só a de depois. Vale para funcionalidade e para problema. |
| Variáveis | Todo símbolo usado num Big-O está declarado em `variaveis`, e todo símbolo declarado é usado. |
| Lista vazia | Aceita para solução sem fluxo executável (só estilo ou documentação); o HTML diz por quê. |
| Conferência | A Fabriquinha confere a gramática e as variáveis. Não confere se o total é a soma correta das etapas nem estima número de operações. A revisão também não confere a complexidade implementada. |

Gramática aceita, sem diferença entre espaços:

```
bigO    = "O(" soma ")"
soma    = produto { "+" produto }
produto = fator { ["*"] fator }                 -- "n log n" e "n*m" são produtos
fator   = "1" | var ["^" inteiro] | "log" ["^" inteiro] var | inteiro "^" var | var "!"
```

Exemplos válidos: `O(1)`, `O(log n)`, `O(n)`, `O(n log n)`, `O(n^2)`, `O(n + m)`, `O(n*m)`, `O(2^n)`, `O(n!)`.
Exemplos recusados: `O(N)` (maiúscula), `O(n²)` (sobrescrito), `O(k)` com `k` não declarado, `n log n` (sem `O(...)`).
O parser é um descendente recursivo pequeno e leva um teste com esses exemplos.

Os números objetivos da demanda e do planejamento não são declarados pela IA; o F6 (5.5) e o F7 os calculam:

- quantos arquivos estão previstos (`arquivosPrevistos`);
- quantas entregas e quantos tickets de desenvolvimento o planejamento aprovado tem;
- quantas dependências e quantos acoplamentos novos o relatório de impactos declara.

`foraDeEscopo` torna explícito o que o desenho não vai fazer.
O planejador e os revisores usam essa lista contra a "ampliação do que deve ser feito".

```ts
// custos_realizados (IA externa) — o que se gastou fora da Fabriquinha para registrar e desenhar; o plugin do harness mede
dados: z.object({
  sessoes: z.array(z.object({
    ferramenta: z.enum(["pi", "claude-code", "codex"]),
    sessao: z.string().trim().min(1).max(200),      // id da sessão no harness
    linhas: z.array(z.object({
      provedor: z.string().trim().min(1),
      modelo: z.string().trim().min(1),
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
      custo: z.number().nonnegative().optional(),   // só o pi traz pronto; nas demais, o F6 calcula
    })),
  })).min(1).refine(unicoPor("sessao"), "sessão repetida"),
}),
arquivos: Arquivos({ max: 0 }),
// regras cruzadas:
// - todo par provedor/modelo sem custo tem preço na tabela do F6 (senão: "falta o preço de <provedor>/<modelo>");
// - sessão (ferramenta, sessao) que outra demanda já submeteu fica com as linhas zeradas e a referência à primeira (F6, 3.4).
```

O retrato vale até o envio da demanda: depois do C25, os custos não mudam.

### 4.2 Planejamento

```ts
// arvore_planejamento (Fabriquinha) — gerada no envio do planejamento, a partir do banco; é o artefato do gate
dados: z.object({
  entregas: z.array(z.object({
    id: Id, titulo: Titulo, criterios: z.array(z.string()), arquivosPrevistos: z.array(z.string()), deps: z.array(Id),
    tickets: z.array(z.object({ id: Id, titulo: Titulo, deps: z.array(Id) })).min(1),
  })).min(1),
}),
arquivos: Arquivos({ classes: ["html"], min: 1, max: 1 }),   // a árvore demanda → entregas → tickets, com os critérios
```

O Auditor ajusta a árvore no gate; a evidência é regerada a cada ajuste, para que a aprovada seja a que vale.
Cada arquivo previsto no `desenho_solucao` da demanda fica em pelo menos uma entrega; o planejador o atrela como atrela os critérios.

### 4.3 Desenvolvimento (produzidas pela Fabriquinha)

```ts
// execucao_testes
dados: z.object({
  comandos: z.array(z.object({
    comando: z.string(),
    codigoSaida: z.number().int().nullable(),   // null quando estourou o tempo
    estourou: z.boolean(),
    duracaoMs: z.number().int().nonnegative(),
    log: z.string(),                            // nome do arquivo de log anexado
  })).min(1),
}),
// aprovada = todo codigoSaida === 0

// relatorio_sonar
dados: z.object({
  projectKey: z.string(),
  ceTaskId: z.string(),
  arquivosAnalisados: z.array(z.string()),
  issues: z.array(z.object({
    arquivo: z.string(),
    linha: z.number().int().optional(),
    regra: z.string(),
    severidade: z.string(),
    mensagem: z.string(),
  })),
}),
// aprovada = issues.length === 0
```

### 4.4 Revisão

```ts
// arquivos_alterados (Fabriquinha) — "relatório de arquivos alterados × desenho inicial"
dados: z.object({
  base: Sha, head: Sha,
  arquivos: z.array(z.object({
    caminho: z.string(),
    status: z.enum(["A", "M", "D", "R"]),
    adicionadas: z.number().int().nonnegative(),
    removidas: z.number().int().nonnegative(),
    previsto: z.string().nullable(),           // o padrão de arquivosPrevistos que casou, ou null
  })),
  previstosNaoTocados: z.array(z.string()),
}),

// matriz_fitness (Fabriquinha)
dados: z.object({
  linhas: z.array(z.object({
    nome: Slug, descricao: z.string(), comando: z.string(),
    codigoSaida: z.number().int().nullable(), estourou: z.boolean(),
    duracaoMs: z.number().int().nonnegative(), log: z.string(),
  })).min(1),
}),
// aprovada = toda linha com codigoSaida === 0

// explicacao_fitness (agente)
dados: z.object({
  explicacoes: z.array(z.object({ nome: Slug, explicacao: z.string().trim().min(1).max(1000) })),
}),
// regra cruzada: exatamente um item por linha da matriz_fitness do mesmo ticket

// comprovacao_criterios (agente)
dados: z.object({
  criterios: z.array(z.object({
    id: z.string().regex(/^CA-\d+$/),
    atendido: z.boolean(),
    comoVerificado: z.string().trim().min(1).max(2000),
    arquivos: z.array(z.string()).min(1),      // nomes de arquivos anexados nesta submissão
  })),
}),
arquivos: Arquivos({ classes: ["video", "imagem"], min: 1 }),
// regras cruzadas: na revisão da entrega, os ids são exatamente os critérios da entrega;
// na revisão da demanda, exatamente os de criterios_aceite da demanda;
// todo nome citado existe entre os anexos. aprovada = todo atendido === true
```

`previsto` compara cada arquivo com os `arquivosPrevistos` da entrega (F1, 3.4.1), atrelados no planejamento a partir do `desenho_solucao` da demanda, usando `path.matchesGlob` da biblioteca padrão do Node.
O diff é o da entrega: de `merge-base(origin/<branchBase>, HEAD)` até `HEAD` na worktree dela.
`previstosNaoTocados` lista só os previstos da entrega.

### 4.5 Encerramento

```ts
// mensagem_pr (agente) — só as partes do PR que exigem julgamento; o resto a Fabriquinha gera (4.6)
dados: z.object({
  titulo: z.string().trim().min(1).max(72),                          // frase no imperativo
  oQueMudou: z.string().trim().min(1).max(3000),                     // seção 2: o que, por que desta forma, limitações
  decisoesNaoObvias: z.array(z.string().trim().min(1).max(1000)),    // seção 3; vazia vira "Nenhuma."
  naoFeito: z.array(z.string().trim().min(1).max(1000)),             // seção 4, além do foraDeEscopo do desenho
  naoPrevistos: z.array(z.object({                                   // seção 5
    caminho: z.string(),
    motivo: z.string().trim().min(1).max(2000),
  })),
  comoRevisar: z.array(z.string().trim().min(1).max(500)).min(1),    // seção 6, em ordem de leitura
  naoVerificado: z.array(z.string().trim().min(1).max(1000)),        // seção 8; vazia vira "Nada."
  reversao: z.string().trim().min(1).max(2000).optional(),           // seção 9
}),
arquivos: Arquivos({ max: 0 }),
// regras cruzadas:
// - naoPrevistos traz exatamente os arquivos com previsto = null no arquivos_alterados da última revisão concluída da entrega;
// - reversao é obrigatória se o relatorio_impactos_arquitetura da demanda tiver impacto ≠ "baixo".

// aula_codigo (agente) — a lógica de cada parte do código alterado, para o Auditor estudar antes de aprovar o PR
dados: z.object({
  trechos: z.array(z.object({                                         // na ordem de leitura
    arquivo: z.string().trim().min(1),                                // caminho como no arquivos_alterados
    inicio: z.number().int().positive(),
    fim: z.number().int().positive(),                                 // fim ≥ inicio; até 60 linhas por trecho
    oQueFaz: z.string().trim().min(1).max(1000),
    porQue: z.string().trim().min(1).max(2000),                       // a lógica por trás do trecho
    decisaoDoDesenho: z.string().trim().min(1).max(1000),
    alternativaDescartada: z.string().trim().min(1).max(1000).optional(),
  })).min(1),
}),
arquivos: Arquivos({ classes: ["html"], min: 1, max: 1 }),           // gerado pela Fabriquinha (5, passo 4)
// regras da geração, contra o arquivos_alterados da última revisão concluída (base..head):
// - o arquivo foi criado ou alterado pela issue e não é binário;
// - o trecho cabe no arquivo da head e toca pelo menos uma linha que o diff `-U0` adicionou ou mudou;
// - o HTML traz o código lido do git (nunca copiado pelo agente), com as linhas alteradas marcadas.

// video_demonstracao (agente) — o sistema funcionando, só pelo cliente; só existe quando a mudança aparece nele
dados: z.object({ roteiro: z.string().trim().min(1).max(2000) }),
arquivos: Arquivos({ classes: ["video"], min: 1, max: 1 }),

// relatorio_produtividade (Fabriquinha) — schema de dados no F6; anexa a versão HTML do relatório

// pr_aberto (Fabriquinha)
dados: z.object({
  hospedagem: z.enum(["github", "azure-devops"]),
  id: z.string(), url: z.url(), branch: z.string(), base: z.string(), head: Sha,
  condensado: z.boolean(),                       // true se o corpo passou pelo 4.7
}),
arquivos: Arquivos({ classes: ["texto"], min: 1, max: 1 }),   // o corpo completo, antes de qualquer condensação
```

### 4.5.1 Encerramento da demanda (produzidas pela Fabriquinha)

```ts
// arvore_prs_criterios_custos — montada do banco; o agente não participa
dados: z.object({
  entregas: z.array(z.object({
    id: Id, titulo: Titulo, correcao: z.boolean(),
    pr: z.object({ url: z.url(), mergeadoEm: Instante }),
    criterios: z.array(z.string()),
  })),
  criterios: z.array(z.object({                 // da comprovacao_criterios da última revisão da demanda
    id: z.string(), atendido: z.boolean(), comoVerificado: z.string(),
  })),
  custos: z.object({                            // US$, por fase; tokens no relatório do F6
    demanda: z.number().nonnegative(),
    planejamento: z.number().nonnegative(),
    entregas: z.array(z.object({ id: Id, custo: z.number().nonnegative() })),
    revisaoDemanda: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }),
}),
arquivos: Arquivos({ classes: ["html"], min: 1, max: 1 }),

// demonstracao_limpeza — a rotina de limpeza do F5 rodada de novo, e a prova de que nada sobrou
dados: z.object({
  worktrees: z.array(z.string()),       // `git worktree list` das entregas e das temporárias; vazia
  pastas: z.array(z.string()),          // pastas de worktree ainda no disco; vazia
  branchesLocais: z.array(z.string()),  // vazia
  branchesRemotas: z.array(z.string()), // vazia
}),
arquivos: Arquivos({ classes: ["texto"], min: 1, max: 1 }),   // a saída dos comandos de verificação
// aprovada = as quatro listas vazias
```

Sessões do pi, logs e evidências ficam: são o histórico da demanda.

### 4.6 Modelo do PR

O PR é sempre montado pela Fabriquinha, em Markdown, porque é o que GitHub e Azure DevOps renderizam.
As explicações em HTML continuam na Fabriquinha; o PR cita cada uma pelo número da issue, o tipo e o nome do arquivo.
Isso responde a "PRs não padronizados" por construção.

**Título:** `<feat|fix>: <titulo> [I-<n>/N-<k>]`, com `feat` para funcionalidade e `fix` para problema.
A frase é do agente e precisa ser imperativa e entendível sozinha no histórico ([Google](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)).

**Corpo:** as 10 seções, sempre nesta ordem e com estes títulos.

| # | Seção | Fonte | Conteúdo |
|---|---|---|---|
| 1 | Por quê | Fabriquinha | Tipo, título e descrição da demanda, a entrega dentro da árvore e os critérios atrelados a ela. O contexto vai no texto, não só num link. |
| 2 | O que mudou | agente | `oQueMudou`: o que mudou, por que desta forma e as limitações da abordagem. |
| 3 | Decisões não óbvias | agente | `decisoesNaoObvias`, ou "Nenhuma." |
| 4 | Fora do escopo | Fabriquinha + agente | `foraDeEscopo` do desenho da demanda e `naoFeito`, ou "Nada declarado." |
| 5 | Arquivos alterados × desenho | Fabriquinha + agente | Tabela do `arquivos_alterados` da última revisão: arquivo, status, linhas +/−, padrão previsto ou "não previsto: <motivo>". |
| 6 | Como revisar | agente | `comoRevisar`, numerado, em ordem de leitura. |
| 7 | Evidências | Fabriquinha | Testes (comando, resultado, duração) e SonarQube (issues e arquivos analisados) do último ticket de desenvolvimento da entrega; fitness (resultado e explicação) da última revisão da entrega; critérios da entrega (id, atendido, como verificado, anexo); complexidade de cada fluxo (antes e depois, tempo e espaço). |
| 8 | Não verificado | agente | `naoVerificado`, ou "Nada." |
| 9 | Riscos e reversão | Fabriquinha + agente | Impacto, riscos e mitigações do relatório de impactos; `reversao` quando houver. |
| 10 | Autoria e custo | Fabriquinha | Declara que o PR foi produzido por agentes pi e traz, por etapa da entrega: modelos, execuções, tokens, custo e reprovações (F6). O custo total da demanda fica no encerramento da demanda. |

Quando o PR já existe (nova volta depois de um PR reprovado), a Fabriquinha atualiza o título e o corpo inteiros; não acrescenta texto ao que havia.

### 4.7 Limite de tamanho do corpo

| Hospedagem | Limite |
|---|---|
| GitHub | 65.536 caracteres |
| Azure DevOps | 4.000 caracteres (limite relatado por usuários; confirmar no primeiro PR real) |

Se o corpo passar do limite, a Fabriquinha condensa nesta ordem e para assim que couber:

1. Seção 5 vira contagem (previstos e não previstos) mais a lista só dos não previstos, com motivo.
2. Seção 7 vira uma linha por evidência (ex.: "Testes 3/3 ✓", "SonarQube 0 issues em 12 arquivos", "Critérios 5/5").
3. Seção 10 vira uma linha com os totais.
4. Se ainda não couber, corta o fim com "… corpo completo em I-<n>, evidência pr_aberto".

As seções do agente nunca são condensadas antes das geradas.
O corpo completo fica sempre anexado à evidência `pr_aberto`.

Limite: quem revisa o PR no GitHub ou no Azure DevOps sem acesso à máquina do Auditor não vê os vídeos nem os HTML.

## 5. Submissão pelo agente e pela IA externa

Comandos (superfície no F7): `fabriquinha evidencia add <tipo> [--dados <arquivo.json>] [--arquivo <caminho>]...` para o agente e `fabriquinha demanda evidencia I-<n> <tipo> [--dados …] [--arquivo …]...` para a IA externa.

Passos, nesta ordem; o primeiro que falhar interrompe sem gravar nada:

1. Resolve o ator: pela execução do ambiente, o ticket precisa estar `em_execucao`; sem execução, é a IA externa, e o ticket é o de demanda da issue, ainda não enviado e registrado pela mesma ferramenta e sessão (`ErroDeEscopo` se não for).
2. O tipo pertence à etapa do ticket e tem o produtor do ator: `agente` ou `externo` (F1, 3.9).
3. Lê `dados` e valida com o schema do tipo.
   O erro sai com o caminho de cada campo, gerado por `z.prettifyError`.
   Exemplo: `dados.criterios[2].entao: obrigatório`.
4. Nos tipos cujo anexo a Fabriquinha gera (`aula_codigo`), recusa anexo do agente, gera o HTML dos `dados` em `$FABRIQUINHA_SAIDA` e segue com ele como anexo.
   Valida cada arquivo: origem permitida (3.2), classe pelos bytes iniciais, limite de tamanho, quantidade.
5. Aplica as regras cruzadas do tipo (ids de critério, linhas da matriz, nomes de anexo).
6. Grava os arquivos no armazenamento por conteúdo (F2, 5.1).
7. Numa transação: C17 com `aprovada` calculada, `evidencia` e `evidencia_arquivo`.

Submeter de novo o mesmo tipo no mesmo ticket substitui a evidência anterior.
A submissão vale até o envio ao gate: com `enviadoEm` o C17 recusa (agente, Fabriquinha e IA externa); só a reprovação do planejamento, que tira o `enviadoEm`, reabre a troca no planejamento; a demanda enviada não reabre.

`fabriquinha evidencia schema <tipo>` imprime o JSON Schema de `dados` (gerado por `z.toJSONSchema`) e as regras de arquivo.
A skill de cada etapa aponta para esse comando, em vez de repetir o formato.

## 6. Coletores (produzidos pela Fabriquinha)

Todos rodam com `cwd` na worktree da entrega, fora de transação (F2, 3.2); os da revisão da demanda e do encerramento da demanda rodam no repositório do projeto, sem worktree de entrega.
Cada comando configurado no projeto roda como `/bin/sh -c "<comando>"`, então aceita `&&`, pipes e variáveis de ambiente.
Passou = código de saída 0; qualquer outro código, ou estouro de tempo, é reprovação.
Cada comando externo tem limite de 30 minutos; ao estourar, o processo é morto e o resultado conta como reprovado.
O stdout e o stderr de cada comando viram um anexo `texto`.
ponytail: o log guarda os últimos 5 MiB; se precisar do início, guardar as duas pontas.

| Coletor | O que faz | Erro de infraestrutura |
|---|---|---|
| Testes | Roda cada comando de `projeto.testes`, todos, mesmo depois de uma falha, para o agente ver o quadro inteiro na próxima tentativa. | Comando não encontrado conta como reprovado. |
| SonarQube | Mesma regra do seu `sonar_gate.py`, em TypeScript: confere `api/system/status`, roda o `sonar-scanner-cli` em Docker sobre a worktree, espera a tarefa do Compute Engine e busca as issues abertas nos arquivos alterados contra `HEAD` (versionados e não versionados). `SONAR_HOST_URL` e `SONAR_TOKEN` vêm do ambiente da Fabriquinha. | SonarQube fora do ar ou scanner falhando: o ticket falha com a mensagem e o comando para subir o servidor. |
| Arquivos alterados | `git diff --numstat` e `--name-status` de `merge-base(base, HEAD)` até `HEAD` (F5) e cruzamento com os `arquivosPrevistos` da entrega. | — |
| Preparação | Não é evidência: o F5 roda `projeto.preparacao` ao criar a worktree. | Falha: a execução falha com o log. |
| Fitness | Roda cada `projeto.fitness[].comando`, todas. No desenvolvimento entra no gate; na revisão vira a matriz que o agente explica. | Comando não encontrado conta como reprovado. |
| Produtividade | Pede o relatório ao F6 e registra. | — |
| PR | Recebe do F5 o PR criado ou atualizado e registra. | Falha do `gh`/`az` faz o ticket falhar com a saída do comando. |
| Árvore do planejamento | Lê do banco as entregas, os tickets, os critérios e as dependências e gera o HTML. Roda no C25 do planejamento e a cada ajuste do Auditor no gate. | — |
| Árvore × PRs × Critérios × Custos | Lê do banco a árvore, os PRs mergeados, a comprovação da última revisão da demanda e os custos do F6, e gera o HTML. | — |
| Limpeza | Roda de novo a rotina idempotente de limpeza do F5 (§5.3) para todas as entregas e worktrees temporárias da issue e registra o que ainda existe. | Falha ao remover: o ticket falha com o caminho e o comando. |

Assim como no `sonar_gate.py`, issue antiga num arquivo alterado também barra: quem mexe no arquivo deixa o arquivo limpo.
Código de teste é excluído no servidor (`sonar.global.exclusions`), como hoje.

## 7. Coleta por etapa

O F4 chama estes passos antes e depois de cada execução autônoma; nas etapas interativas, o descarte vem quando o Auditor aprova o gate.
"Depois" só roda quando o pi saiu com sucesso; se o pi falhou, o ticket falha direto.

| Etapa | Antes do pi | Depois do pi |
|---|---|---|
| demanda | — (não há pi) | — |
| planejamento | worktree temporária da base atualizada (F5) | árvore do planejamento, no C25; remoção da worktree temporária, no gate aprovado |
| desenvolvimento | worktree da entrega, na primeira execução dela (F5) | testes → se aprovada, fitness → se aprovada, SonarQube → se aprovada, commit (F5) |
| revisao | arquivos alterados; fitness | descartar alterações (F5) |
| encerramento | — | descartar alterações (F5); produtividade da entrega (F6); push e PR (F5); verificação do PR: conflito e CI (F5 §5.1) |
| sessao | — | descartar alterações (F5) |
| revisao_demanda | worktree temporária da base atualizada (F5) | remoção da worktree temporária |
| encerramento_demanda | — (não há pi) | limpeza; árvore × PRs × critérios × custos |
| sessao_final | worktree temporária da base atualizada (F5) | remoção da worktree temporária |

**Só o ticket de desenvolvimento muda código.**
Nas demais etapas, a Fabriquinha descarta as alterações da worktree ao fim da execução, depois de as evidências já estarem guardadas.
Isso cobre três coisas:

- o planejador e o revisor da demanda leem o código sem vazar nada, porque a worktree deles é temporária;
- a revisão não altera funcionalidade ("revisão altera funcionalidades ou problemas não envolvidos");
- o encerramento não sobe lixo no PR ("trabalhos encerrados sem limpeza").

Lixo que chegou a ser commitado em algum ticket de desenvolvimento aparece no relatório de arquivos alterados como `previsto: null`, para o revisor exigir a remoção.

## 8. Regras que este módulo acrescenta ao C7 do F1

| Etapa | Regra |
|---|---|
| revisao | Aprovar exige `comprovacao_criterios.aprovada` (todos os critérios atendidos) e `matriz_fitness.aprovada` (todas as fitness passaram). |
| revisao_demanda | Aprovar exige `comprovacao_criterios.aprovada` sobre todos os critérios da demanda. |
| encerramento_demanda | Exige `demonstracao_limpeza.aprovada`; o que sobrou é removido de novo antes de reprovar a coleta. |

A segunda regra é a resposta direta a "complexidade elevada é enviada para PR".
Com ela, uma fitness function vermelha obriga a revisão a reprovar e gerar ticket.

## 9. Interface do módulo

| Função | Quem chama |
|---|---|
| `schemaDe(tipo)` / `jsonSchemaDe(tipo)` | F7 (`evidencia schema`), testes |
| `submeter(banco, ator, tipo, dados, caminhos)` | F7 (`evidencia add`) |
| `antesDoPi(banco, ticket)` / `depoisDoPi(banco, ticket)` | F4 |
| `arquivosDaEvidencia(banco, evidencia)` | F7 (exibição e download) |

## 10. Verificação

- Um teste por schema com um exemplo válido e os inválidos mais prováveis de um agente: campo faltando, id fora do padrão, arquivo de outra classe.
- Teste do caminho: link simbólico apontando para fora da worktree é recusado.
- Teste dos coletores de testes e fitness com comandos falsos (`true`, `false`, `sleep` além do limite).
- O coletor do SonarQube é testado contra o servidor local em um teste de integração separado, porque depende do Docker.

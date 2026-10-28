// Conteúdo de cada tipo de evidência (F3 §3.1, §4): o schema de `dados` e as regras dos arquivos.
import { z } from "zod";
import type { Agregado, Evidencia, TipoEvidencia } from "../dominio/agregado.ts";
import { Plano } from "../dominio/demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { TipoEvidenciaEtapa } from "../dominio/evidencia_etapa.ts";
import { type Etapa, type Id, Motivo, Slug, Titulo, unicoPor } from "../dominio/primitivos.ts";
import { Hospedagem } from "../dominio/projeto.ts";

/** F3 §3.1: a classe vem dos bytes iniciais, nunca da extensão. */
export const Classe = z.enum(["video", "imagem", "html", "texto"]);
export type Classe = z.infer<typeof Classe>;

const MiB = 1024 * 1024;
/** F3 §3.1: tamanho máximo de um anexo de cada classe. */
export const LIMITE: Readonly<Record<Classe, number>> = {
  video: 500 * MiB,
  imagem: 20 * MiB,
  html: 5 * MiB,
  texto: 5 * MiB,
};
/** O mime de um anexo da classe `texto`. */
export const MIME_TEXTO = "text/plain; charset=utf-8";
/** O mime de um anexo da classe `html`. */
export const MIME_HTML = "text/html; charset=utf-8";

export interface RegraArquivos {
  readonly classes: readonly Classe[];
  readonly min: number;
  /** Ausente: sem limite de quantidade. */
  readonly max?: number;
  /** Pelo menos um anexo de uma destas classes, com a mensagem para o agente. */
  readonly temClasse?: { readonly classes: readonly Classe[]; readonly mensagem: string };
}

const Arquivos = ({ classes = Classe.options, min = 0, max, temClasse }: Partial<RegraArquivos>): RegraArquivos => ({
  classes,
  min,
  ...(max !== undefined && { max }),
  ...(temClasse && { temClasse }),
});

/** O que as regras cruzadas consultam: o agregado antes da submissão, o ticket e os nomes dos anexos. */
export interface Cruzamento {
  readonly ag: Agregado;
  readonly ticket: Id;
  readonly anexos: readonly string[];
}

export interface SchemaEvidencia<Dados extends Record<string, unknown> = Record<string, unknown>> {
  readonly dados: z.ZodType<Dados>;
  readonly arquivos: RegraArquivos;
  /** F3 §5, passo 5: as regras cruzadas do tipo; lança ErroDeRegra com o que corrigir. */
  cruzar?(dados: Dados, c: Cruzamento): void;
  /** F3 §2: `aprovada` calculada do conteúdo, nos tipos com resultado binário. */
  aprovada?(dados: Dados): boolean;
}

/** Infere o tipo de `dados` nas regras do schema, que o registro guarda sem ele. */
const tipado = <Dados extends Record<string, unknown>>(schema: SchemaEvidencia<Dados>): SchemaEvidencia => schema;

/** Os nomes de `de`, em ordem, para comparar com os esperados de uma regra cruzada. */
const ordenados = (de: readonly string[]): string => `[${de.toSorted((a, b) => a.localeCompare(b)).join(", ")}]`;

/** Os valores de `campo` de cada item de `lista` nos `dados` das evidências `tipo` que passam no filtro. */
const daEvidencia = (ag: Agregado, tipo: TipoEvidencia, lista: string, campo: string, ticket?: Id): string[] =>
  ag.evidencias
    .filter((e) => e.tipo === tipo && (ticket === undefined || e.ticket === ticket))
    .flatMap((e) => (e.dados[lista] as Record<string, string>[]).map((item) => String(item[campo])));

/**
 * A evidência `tipo` do último ticket concluído da `etapa`: a do desenho aprovado, a da revisão que levou ao
 * encerramento, a do último ticket de desenvolvimento.
 */
export function daUltimaConcluida(ag: Agregado, etapa: Etapa, tipo: TipoEvidencia): Evidencia | undefined {
  const ticket = ag.tickets.findLast((t) => t.etapa === etapa && t.status === "concluido");
  return ticket && ag.evidencias.find((e) => e.ticket === ticket.id && e.tipo === tipo);
}

const Criterio = z.object({
  id: z.string().regex(/^CA-\d+$/),
  dado: z.string().trim().min(1),
  quando: z.string().trim().min(1),
  entao: z.string().trim().min(1),
});

/** Texto livre de até 2.000 caracteres: o mesmo formato do `Motivo` do F1, para campos que não são motivo. */
const Texto = Motivo;

/**
 * Caminho na worktree, casado com os arquivos alterados por `path.matchesGlob` (F3 §4.4): aceita glob; sem `.` nem
 * `..` como segmento, sem caminho absoluto e sem `/` no fim, formas que nunca casam com um caminho do git.
 */
const CaminhoRelativo = z
  .string()
  .trim()
  .min(1)
  .refine((c) => !c.startsWith("/"), "caminho absoluto; use o caminho a partir da raiz do repositório")
  .refine((c) => !c.split("/").includes(".."), "o caminho não pode ter ..")
  .refine((c) => !c.split("/").includes("."), "o caminho não pode ter ./; escreva-o a partir da raiz, como src/a.ts")
  .refine((c) => !c.endsWith("/"), "o caminho não pode terminar em /; para uma pasta inteira use pasta/**")
  .meta({
    description:
      "Caminho a partir da raiz do repositório, com glob (*, **). Curinga não alcança segmento que começa com " +
      "ponto: **/*.yml não casa com .github/ci.yml; use o caminho explícito ou .github/**.",
  });

/** Nome de variável do Big-O, o mesmo na declaração e no uso; `log` é reservado. */
const SIMBOLO = /^[a-z][a-z0-9_]{0,15}$/;
const INTEIRO = /^\d+$/;

/**
 * Os símbolos de um Big-O na gramática do F3 §4.2, ou `undefined` se a expressão está fora dela. Descendente
 * recursivo; espaço só separa tokens.
 *   bigO    = "O(" soma ")"
 *   soma    = produto { "+" produto }
 *   produto = fator { ["*"] fator }
 *   fator   = "1" | var ["^" inteiro] | "log" ["^" inteiro] var | inteiro "^" var | var "!"
 */
export function simbolosDe(expressao: string): ReadonlySet<string> | undefined {
  // Qualquer outro caractere (maiúscula, sobrescrito) vira um token sozinho, que nenhuma regra aceita.
  const tokens = expressao.match(/[a-z][a-z0-9_]*|\d+|\S/g) ?? [];
  const simbolos = new Set<string>();
  let i = 0;
  const casa = (padrao: string | RegExp): string | undefined => {
    const token = tokens[i];
    if (token === undefined || !(typeof padrao === "string" ? token === padrao : padrao.test(token))) return undefined;
    i++;
    return token;
  };
  const exige = (padrao: string | RegExp): string => {
    const token = casa(padrao);
    if (token === undefined) throw new SyntaxError(`esperava ${String(padrao)} na posição ${String(i)}`);
    return token;
  };
  const variavel = () => {
    const simbolo = exige(SIMBOLO);
    if (simbolo === "log") throw new SyntaxError("log é reservado");
    simbolos.add(simbolo);
  };
  const fator = () => {
    const inteiro = casa(INTEIRO);
    if (inteiro !== undefined) {
      if (inteiro === "1" && tokens[i] !== "^") return;
      exige("^");
      variavel();
    } else if (casa("log") === undefined) {
      variavel();
      if (casa("^") === undefined) casa("!");
      else exige(INTEIRO);
    } else {
      if (casa("^") !== undefined) exige(INTEIRO);
      variavel();
    }
  };
  const produto = () => {
    fator();
    while (casa("*") !== undefined || /^[a-z\d]/.test(tokens[i] ?? "")) fator();
  };
  try {
    exige("O");
    exige("(");
    produto();
    while (casa("+") !== undefined) produto();
    exige(")");
    return i === tokens.length ? simbolos : undefined;
  } catch {
    return undefined;
  }
}

const BigO = z
  .string()
  .refine((s) => simbolosDe(s) !== undefined, "fora da gramática Big-O (ex.: O(1), O(n log n), O(n^2), O(n + m))")
  .meta({
    description:
      'Pior caso. Gramática: bigO = "O(" soma ")"; soma = produto { "+" produto }; produto = fator { ["*"] fator }; ' +
      'fator = "1" | var ["^" inteiro] | "log" ["^" inteiro] var | inteiro "^" var | var "!". Todo var vem de variaveis.',
  });
const Complexidade = z.object({ tempo: BigO, espaco: BigO });

const Fluxo = z
  .object({
    nome: Titulo,
    gatilho: z.string().trim().min(1).max(300),
    situacao: z.enum(["novo", "alterado"]),
    antes: Complexidade.optional(),
    depois: Complexidade,
  })
  .refine((f) => (f.situacao === "alterado") === (f.antes !== undefined), {
    message: "antes é obrigatório se e somente se situacao = alterado",
    path: ["antes"],
  });

const RelatorioComplexidade = z
  .object({
    variaveis: z
      .array(
        z.object({
          simbolo: z
            .string()
            .regex(SIMBOLO)
            .refine((s) => s !== "log", "log é reservado"),
          significado: z.string().trim().min(1).max(300),
        }),
      )
      .refine(unicoPor("simbolo"), "símbolo declarado duas vezes"),
    fluxos: z.array(Fluxo).refine(unicoPor("nome"), "dois fluxos com o mesmo nome"),
  })
  .superRefine(({ variaveis, fluxos }, ctx) => {
    const declarados = new Set(variaveis.map((v) => v.simbolo));
    const usados = new Set<string>();
    fluxos.forEach((fluxo, f) => {
      for (const quando of ["antes", "depois"] as const) {
        for (const medida of ["tempo", "espaco"] as const) {
          // Expressão fora da gramática ou `antes` indevido já têm o erro do próprio campo.
          const expressao = fluxo[quando]?.[medida];
          const simbolos = expressao === undefined ? undefined : simbolosDe(expressao);
          for (const simbolo of simbolos ?? []) {
            usados.add(simbolo);
            if (!declarados.has(simbolo)) {
              ctx.addIssue({
                code: "custom",
                message: `${simbolo} não está declarado em variaveis`,
                path: ["fluxos", f, quando, medida],
              });
            }
          }
        }
      }
    });
    variaveis.forEach(({ simbolo }, v) => {
      if (!usados.has(simbolo)) {
        ctx.addIssue({
          code: "custom",
          message: `${simbolo} não é usado em nenhum Big-O`,
          path: ["variaveis", v, "simbolo"],
        });
      }
    });
  });

const HTML_UNICO = Arquivos({ classes: ["html"], min: 1, max: 1 });

/** Um comando rodado por um coletor (F3 §6); `log` é o nome do anexo com o stdout e o stderr dele. */
const ComandoRodado = z.object({
  comando: z.string(),
  codigoSaida: z.number().int().nullable().meta({ description: "null quando estourou o tempo" }),
  estourou: z.boolean(),
  duracaoMs: z.number().int().nonnegative(),
  log: z.string(),
});
const LOGS = Arquivos({ classes: ["texto"], min: 1 });

/** SHA-1 ou SHA-256 de um commit. */
const Sha = z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/);
/** Linhas de um arquivo no diff; `null` em arquivo binário, como no F5 §7. */
const Linhas = z.number().int().nonnegative().nullable();

const ExplicacaoFitness = z.object({
  explicacoes: z.array(z.object({ nome: Slug, explicacao: z.string().trim().min(1).max(1000) })),
});

const ComprovacaoCriterios = z.object({
  criterios: z.array(
    z.object({
      id: z.string().regex(/^CA-\d+$/),
      atendido: z.boolean(),
      comoVerificado: Texto,
      arquivos: z.array(z.string()).min(1).meta({ description: "nomes de arquivos anexados nesta submissão" }),
    }),
  ),
});

/** Texto não vazio de até `max` caracteres. */
const TextoAte = (max: number) => z.string().trim().min(1).max(max);

// F3 §4.5: só as partes do PR que exigem julgamento; o resto a Fabriquinha gera (§4.6).
const MensagemPR = z.object({
  titulo: TextoAte(72)
    .regex(/^[^\r\n]*$/, "título ocupa uma linha só")
    .meta({ description: "frase no imperativo, entendível sozinha no histórico" }),
  oQueMudou: TextoAte(3000).meta({ description: "o que mudou, por que desta forma e as limitações da abordagem" }),
  decisoesNaoObvias: z.array(TextoAte(1000)),
  naoFeito: z.array(TextoAte(1000)).meta({ description: "o que não foi feito, além do foraDeEscopo do desenho" }),
  naoPrevistos: z
    .array(z.object({ caminho: z.string(), motivo: TextoAte(2000) }))
    .meta({ description: "um item por arquivo com previsto null no arquivos_alterados da última revisão" }),
  comoRevisar: z.array(TextoAte(500)).min(1).meta({ description: "passos em ordem de leitura" }),
  naoVerificado: z.array(TextoAte(1000)),
  reversao: TextoAte(2000)
    .optional()
    .meta({ description: "como desfazer; obrigatória se o impacto do desenho aprovado não é baixo" }),
});

/** Até 60 linhas: um trecho de aula é uma ideia; um trecho maior se divide. */
const LINHAS_POR_TRECHO = 60;

// F3 §4.5: só a explicação de cada trecho; o código e o HTML a Fabriquinha lê do git e gera (aula.ts).
const AulaCodigo = z.object({
  trechos: z
    .array(
      z
        .object({
          arquivo: z.string().trim().min(1).meta({ description: "caminho como aparece no arquivos_alterados" }),
          inicio: z.number().int().positive().meta({ description: "primeira linha do trecho no arquivo atual" }),
          fim: z.number().int().positive().meta({ description: "última linha do trecho, inclusive" }),
          oQueFaz: TextoAte(1000),
          porQue: TextoAte(2000).meta({ description: "a lógica por trás do trecho: por que ele é escrito assim" }),
          decisaoDoDesenho: TextoAte(1000).meta({ description: "a decisão do desenho aprovado que o trecho cumpre" }),
          alternativaDescartada: TextoAte(1000).optional(),
        })
        .refine((t) => t.fim >= t.inicio, { message: "fim vem antes de inicio", path: ["fim"] })
        .refine((t) => t.fim - t.inicio < LINHAS_POR_TRECHO, {
          message: `trecho com mais de ${String(LINHAS_POR_TRECHO)} linhas; divida-o`,
          path: ["fim"],
        }),
    )
    .min(1)
    .meta({ description: "na ordem de leitura" }),
});

/** Todos os tipos do F3 §2. */
const SCHEMAS: Record<TipoEvidencia, SchemaEvidencia> = {
  // "vídeo / código do comportamento atual e/ou do problema"
  comportamento: {
    dados: z.object({
      descricao: z.string().trim().min(1).max(2000),
      comoReproduzir: z.array(z.string().trim().min(1)).min(1),
    }),
    arquivos: Arquivos({ classes: ["video", "texto"], min: 1 }),
  },
  criterios_aceite: {
    dados: z.object({
      criterios: z.array(Criterio).min(1).refine(unicoPor("id"), "id de critério repetido"),
    }),
    arquivos: Arquivos({ max: 0 }),
  },
  // O HTML explica a solução ao Auditor; `dados` guarda o que a máquina confere.
  desenho_solucao: {
    dados: z.object({
      resumo: Texto,
      arquivosPrevistos: z
        .array(
          z.object({
            caminho: CaminhoRelativo,
            acao: z.enum(["criar", "alterar", "remover"]),
            motivo: Motivo,
          }),
        )
        .min(1),
      foraDeEscopo: z.array(z.string().trim().min(1)).default([]),
    }),
    arquivos: HTML_UNICO,
  },
  // Obrigatório só quando a issue é funcionalidade (catálogo do F1).
  prototipo: {
    dados: z.object({
      descricao: Texto,
      comoExecutar: z.string().trim().max(2000).optional(),
    }),
    arquivos: Arquivos({
      min: 1,
      temClasse: { classes: ["video", "imagem"], mensagem: "protótipo precisa de pelo menos um vídeo ou print" },
    }),
  },
  // O HTML traz as etapas de cada fluxo, do gatilho ao fim, com o mesmo `nome` do JSON.
  relatorio_complexidade: { dados: RelatorioComplexidade, arquivos: HTML_UNICO },
  relatorio_impactos_arquitetura: {
    dados: z.object({
      impacto: z.enum(["baixo", "medio", "alto"]),
      novasDependencias: z.array(z.object({ nome: z.string().trim().min(1), motivo: Motivo })),
      novosAcoplamentos: z.array(
        z.object({ de: z.string().trim().min(1), para: z.string().trim().min(1), motivo: Motivo }),
      ),
      riscos: z.array(z.object({ descricao: Texto, mitigacao: Texto })),
    }),
    arquivos: HTML_UNICO,
  },
  // Produzidas pelos coletores (F3 §6); aprovada quando cada codigoSaida é 0.
  execucao_testes: { dados: z.object({ comandos: z.array(ComandoRodado).min(1) }), arquivos: LOGS },
  matriz_fitness: {
    dados: z.object({
      linhas: z.array(z.object({ nome: Slug, descricao: z.string(), ...ComandoRodado.shape })).min(1),
    }),
    arquivos: LOGS,
  },
  // Produzida pela Fabriquinha (F3 §4.3, §6): aprovada = nenhuma issue aberta nos arquivos alterados.
  relatorio_sonar: {
    dados: z.object({
      projectKey: z.string(),
      ceTaskId: z.string(),
      arquivosAnalisados: z.array(z.string()),
      issues: z.array(
        z.object({
          arquivo: z.string(),
          linha: z.number().int().optional(),
          regra: z.string(),
          severidade: z.string(),
          mensagem: z.string(),
        }),
      ),
    }),
    arquivos: Arquivos({ max: 0 }),
  },
  // Produzida pela Fabriquinha antes do pi da revisão (F3 §4.4, §7): o diff da issue × o desenho aprovado.
  arquivos_alterados: {
    dados: z.object({
      base: Sha,
      head: Sha,
      arquivos: z.array(
        z.object({
          caminho: z.string(),
          status: z.enum(["A", "M", "D", "R"]),
          adicionadas: Linhas,
          removidas: Linhas,
          previsto: z.string().nullable().meta({ description: "o padrão de arquivosPrevistos que casou, ou null" }),
        }),
      ),
      previstosNaoTocados: z.array(z.string()),
    }),
    arquivos: Arquivos({ max: 0 }),
  },
  explicacao_fitness: tipado({
    dados: ExplicacaoFitness,
    arquivos: Arquivos({ max: 0 }),
    cruzar({ explicacoes }, { ag, ticket }) {
      const linhas = daEvidencia(ag, "matriz_fitness", "linhas", "nome", ticket);
      const nomes = explicacoes.map((e) => e.nome);
      if (ordenados(nomes) !== ordenados(linhas)) {
        throw new ErroDeRegra(
          `explicacao_fitness explica ${ordenados(nomes)}, e a matriz_fitness de T-${String(ticket)} tem as linhas ${ordenados(linhas)}`,
          "submeta exatamente uma explicação por linha da matriz",
        );
      }
    },
  }),
  comprovacao_criterios: tipado({
    dados: ComprovacaoCriterios,
    arquivos: Arquivos({ classes: ["video", "imagem"], min: 1 }),
    cruzar({ criterios }, { ag, anexos }) {
      const esperados = daEvidencia(ag, "criterios_aceite", "criterios", "id");
      const ids = criterios.map((c) => c.id);
      if (ordenados(ids) !== ordenados(esperados)) {
        throw new ErroDeRegra(
          `comprovacao_criterios comprova ${ordenados(ids)}, e os critérios de aceite do registro são ${ordenados(esperados)}`,
          "submeta exatamente uma comprovação por critério de aceite",
        );
      }
      const semAnexo = [...new Set(criterios.flatMap((c) => c.arquivos))].filter((nome) => !anexos.includes(nome));
      if (semAnexo.length > 0) {
        throw new ErroDeRegra(
          `comprovacao_criterios cita ${semAnexo.join(", ")}, que não está entre os anexos`,
          "anexe cada arquivo citado com --arquivo <caminho>, com o mesmo nome",
        );
      }
    },
    aprovada: ({ criterios }) => criterios.every((c) => c.atendido),
  }),
  mensagem_pr: tipado({
    dados: MensagemPR,
    arquivos: Arquivos({ max: 0 }),
    cruzar({ naoPrevistos, reversao }, { ag }) {
      const alterados = (daUltimaConcluida(ag, "revisao", "arquivos_alterados")?.dados.arquivos ?? []) as {
        caminho: string;
        previsto: string | null;
      }[];
      const esperados = alterados.filter((a) => a.previsto === null).map((a) => a.caminho);
      const citados = naoPrevistos.map((n) => n.caminho);
      if (ordenados(citados) !== ordenados(esperados)) {
        throw new ErroDeRegra(
          `mensagem_pr explica os não previstos ${ordenados(citados)}, e a última revisão concluída tem ${ordenados(esperados)}`,
          "submeta em naoPrevistos exatamente um item por arquivo com previsto null no arquivos_alterados, com o motivo",
        );
      }
      const impacto = daUltimaConcluida(ag, "desenho", "relatorio_impactos_arquitetura")?.dados.impacto;
      if (reversao === undefined && impacto !== undefined && impacto !== "baixo") {
        throw new ErroDeRegra(
          `mensagem_pr não tem reversao, e o impacto do desenho aprovado é ${impacto as string}`,
          "descreva em reversao como desfazer a mudança",
        );
      }
    },
  }),
  // O agente não anexa nada: a Fabriquinha gera o HTML da aula na submissão (F3 §5).
  aula_codigo: { dados: AulaCodigo, arquivos: HTML_UNICO },
  video_demonstracao: {
    dados: z.object({ roteiro: Texto }),
    arquivos: Arquivos({ classes: ["video"], min: 1, max: 1 }),
  },
  // Produzidas pela Fabriquinha no encerramento da rodada: a produtividade (produtividade_rodada.ts), que nunca passa
  // por aqui, e o PR com o corpo completo, antes de qualquer condensação (F3 §4.7).
  relatorio_produtividade: { dados: z.record(z.string(), z.unknown()), arquivos: HTML_UNICO },
  pr_aberto: {
    dados: z.object({
      hospedagem: Hospedagem,
      id: z.string(),
      url: z.url(),
      branch: z.string(),
      base: z.string(),
      head: Sha,
      condensado: z.boolean().meta({ description: "true se o corpo publicado passou pela condensação do F3 §4.7" }),
    }),
    arquivos: Arquivos({ classes: ["texto"], min: 1, max: 1 }),
  },
};

export const schemaDe = (tipo: TipoEvidencia): SchemaEvidencia => SCHEMAS[tipo];

/**
 * "Não se aplica" só com justificativa; aplicável, a lista de `itens` não pode ficar vazia. `campo` é a lista do tipo
 * (`cenarios`, `ameacas`) e `listas` as que ficam vazias quando não se aplica.
 */
function conferirAplicabilidade(
  d: { aplicavel: boolean; justificativa?: string | undefined } & Record<string, unknown>,
  ctx: z.RefinementCtx,
  campo: string,
  listas: readonly string[],
): void {
  const erro = (message: string, path: string) => {
    ctx.addIssue({ code: "custom", message, path: [path] });
  };
  if (d.aplicavel) {
    if ((d[campo] as unknown[]).length === 0) erro(`aplicavel é true: informe pelo menos um item em ${campo}`, campo);
    return;
  }
  if (d.justificativa === undefined) erro("aplicavel é false: justifique por que não se aplica", "justificativa");
  for (const lista of listas) {
    if ((d[lista] as unknown[]).length > 0) erro(`aplicavel é false: ${lista} deve ficar vazia`, lista);
  }
}

const Justificativa = Texto.optional().meta({ description: "obrigatória se aplicavel é false" });

const TestesEstresse = z
  .object({
    aplicavel: z.boolean(),
    justificativa: Justificativa,
    cenarios: z.array(
      z.object({
        nome: Titulo,
        objetivo: Texto,
        comando: z.string().trim().min(1),
        resultado: z.enum(["passou", "quebrou"]),
        observado: Texto,
      }),
    ),
  })
  .superRefine((d, ctx) => {
    conferirAplicabilidade(d, ctx, "cenarios", ["cenarios"]);
  });

const AnaliseSeguranca = z
  .object({
    aplicavel: z.boolean(),
    justificativa: Justificativa,
    ameacas: z.array(z.object({ descricao: Texto, mitigacao: Texto })),
    achados: z.array(
      z.object({
        descricao: Texto,
        severidade: z.enum(["baixa", "media", "alta", "critica"]),
        arquivo: CaminhoRelativo.optional(),
        recomendacao: Texto,
      }),
    ),
  })
  .superRefine((d, ctx) => {
    conferirAplicabilidade(d, ctx, "ameacas", ["ameacas", "achados"]);
  });

const LOGS_OPCIONAIS = Arquivos({ classes: ["texto"] });

/** Contador de tokens: inteiro não negativo, com a mensagem que orienta a ferramenta externa. */
const Tokens = (campo: string) =>
  z
    .number({ error: `${campo} é obrigatório: informe o total de tokens como inteiro >= 0` })
    .int(`${campo} deve ser inteiro: informe o total de tokens sem fração`)
    .nonnegative(`${campo} não pode ser negativo: informe 0 se não houve tokens`);

/** Texto obrigatório de `custos_realizados`: a mensagem diz o campo e como corrigir. */
const Obrigatorio = (campo: string, como: string) =>
  z
    .string({ error: `${campo} é obrigatório: ${como}` })
    .trim()
    .min(1, `${campo} é obrigatório: ${como}`);

// Custo externo (D10): uma sessão da ferramenta fora da Fabriquinha, com linhas por provedor/modelo. Custo ausente é
// desconhecido (null), nunca 0, e não há tabela de preços.
const CustosRealizados = z.object({
  sessoes: z
    .array(
      z.object({
        ferramenta: Obrigatorio("ferramenta", "informe a ferramenta externa usada, como claude ou codex"),
        sessao: Obrigatorio("sessao", "informe o id da sessão no harness da ferramenta"),
        linhas: z
          .array(
            z.object({
              provedor: Obrigatorio("provedor", "informe o provedor do modelo, como anthropic"),
              modelo: Obrigatorio("modelo", "informe o nome do modelo usado"),
              tokens_entrada: Tokens("tokens_entrada"),
              tokens_saida: Tokens("tokens_saida"),
              tokens_cache_leitura: Tokens("tokens_cache_leitura"),
              tokens_cache_escrita: Tokens("tokens_cache_escrita"),
              custo: z
                .number()
                .nonnegative("custo não pode ser negativo: omita o campo se o custo é desconhecido")
                .nullish()
                .transform((c) => c ?? null)
                .meta({ description: "custo em dólares; omita se desconhecido (fica null, nunca 0)" }),
            }),
          )
          .min(1, "linhas é obrigatório: informe pelo menos uma linha por provedor/modelo"),
      }),
      { error: "sessoes é obrigatório: informe a lista de sessões externas" },
    )
    .refine(
      (sessoes) => new Set(sessoes.map((s) => `${s.ferramenta}\0${s.sessao}`)).size === sessoes.length,
      "sessão repetida: informe cada sessao uma vez só, juntando as linhas dela",
    ),
});

/** As evidências do catálogo novo (SDLC por demandas) que já têm schema; o CLI ainda não as liga a `TipoEvidencia`. */
const SCHEMAS_ETAPA: Record<
  Extract<TipoEvidenciaEtapa, "plano" | "testes_estresse" | "analise_seguranca"> | "custos_realizados",
  SchemaEvidencia
> = {
  custos_realizados: tipado({ dados: CustosRealizados, arquivos: Arquivos({ max: 0 }) }),
  // O cruzamento do plano com a demanda congelada é da camada que submete.
  plano: tipado({ dados: Plano, arquivos: Arquivos({ max: 0 }) }),
  testes_estresse: tipado({
    dados: TestesEstresse,
    arquivos: LOGS_OPCIONAIS,
    aprovada: ({ cenarios }) => cenarios.every((c) => c.resultado === "passou"),
  }),
  analise_seguranca: tipado({
    dados: AnaliseSeguranca,
    arquivos: LOGS_OPCIONAIS,
    aprovada: ({ achados }) => achados.every((a) => a.severidade === "baixa" || a.severidade === "media"),
  }),
};

export type TipoSchemaEtapa = keyof typeof SCHEMAS_ETAPA;

export const schemaDeEtapa = (tipo: TipoSchemaEtapa): SchemaEvidencia => SCHEMAS_ETAPA[tipo];

// Conteúdo de cada tipo de evidência (F3 §3.1, §4): o schema de `dados` e as regras dos arquivos.
import { z } from "zod";
import type { Agregado, TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { type Id, Motivo, Slug, Titulo, unicoPor } from "../dominio/primitivos.ts";

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

/** Os tipos já implementados; os demais entram com as etapas que os usam. */
const SCHEMAS: Partial<Record<TipoEvidencia, SchemaEvidencia>> = {
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
};

export function schemaDe(tipo: TipoEvidencia): SchemaEvidencia {
  const schema = SCHEMAS[tipo];
  if (!schema) {
    throw new ErroDeRegra(
      `a Fabriquinha ainda não valida evidências do tipo ${tipo}`,
      `os tipos aceitos hoje são ${Object.keys(SCHEMAS).join(", ")}`,
    );
  }
  return schema;
}

/** O formato que o agente envia (`fabriquinha evidencia schema <tipo>`): JSON Schema de `dados` e as regras de arquivo. */
export function jsonSchemaDe(tipo: TipoEvidencia): { dados: z.core.JSONSchema.BaseSchema; arquivos: RegraArquivos } {
  const { dados, arquivos } = schemaDe(tipo);
  return { dados: z.toJSONSchema(dados, { io: "input" }), arquivos };
}

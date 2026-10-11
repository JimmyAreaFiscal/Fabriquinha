// Conteúdo de cada tipo de evidência (F3 §3.1, §4): o schema de `dados` e as regras dos arquivos.
import { z } from "zod";
import type { TipoEvidencia } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { Motivo, Slug, Titulo, unicoPor } from "../dominio/primitivos.ts";

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

export interface SchemaEvidencia {
  readonly dados: z.ZodType<Record<string, unknown>>;
  readonly arquivos: RegraArquivos;
}

const Criterio = z.object({
  id: z.string().regex(/^CA-\d+$/),
  dado: z.string().trim().min(1),
  quando: z.string().trim().min(1),
  entao: z.string().trim().min(1),
});

/** Texto livre de até 2.000 caracteres: o mesmo formato do `Motivo` do F1, para campos que não são motivo. */
const Texto = Motivo;

/** Caminho na worktree: aceita glob; sem `..` e sem caminho absoluto. */
const CaminhoRelativo = z
  .string()
  .trim()
  .min(1)
  .refine((c) => !c.startsWith("/"), "caminho absoluto; use o caminho a partir da raiz do repositório")
  .refine((c) => !c.split("/").includes(".."), "o caminho não pode ter ..");

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

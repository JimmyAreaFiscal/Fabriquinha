// Conteúdo de cada tipo de evidência (F3 §3.1, §4): o schema de `dados` e as regras dos arquivos.
import { z } from "zod";
import type { AgregadoDemanda, EvidenciaDemanda } from "./agregado_demanda.ts";
import type { TipoEvidencia } from "./evidencia.ts";
import { ticketAtualDaEtapa } from "./item_de_trabalho.ts";
import { type EtapaTicket, type Id, Motivo, Slug, Titulo, unicoPor } from "./primitivos.ts";

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

export const Arquivos = ({
  classes = Classe.options,
  min = 0,
  max,
  temClasse,
}: Partial<RegraArquivos>): RegraArquivos => ({
  classes,
  min,
  ...(max !== undefined && { max }),
  ...(temClasse && { temClasse }),
});

/** O que as regras cruzadas consultam: o agregado antes da submissão, o ticket e os nomes dos anexos. */
interface Cruzamento {
  readonly ag: AgregadoDemanda;
  readonly ticket: Id;
  readonly anexos: readonly string[];
}

type Veredito = "atende" | "nao_atende";

export const vereditoDe = (atende: boolean): Veredito => (atende ? "atende" : "nao_atende");

export interface EsquemaDeEvidencia<Dados extends Record<string, unknown> = Record<string, unknown>> {
  readonly dados: z.ZodType<Dados>;
  readonly arquivos: RegraArquivos;
  /** F3 §5, passo 5: as regras cruzadas do tipo; lança ErroDeRegra com o que corrigir. */
  cruzar?(dados: Dados, c: Cruzamento): void;
  /** F3 §2: o veredito calculado do conteúdo, nos tipos com resultado binário; nada é gravado. */
  veredito?(dados: Dados): Veredito;
}

/**
 * A evidência `tipo` do último ticket concluído da `etapa`: a da revisão que levou ao encerramento, a do último
 * ticket de desenvolvimento.
 */
export function daUltimaConcluida(
  ag: AgregadoDemanda,
  etapa: EtapaTicket,
  tipo: TipoEvidencia,
): EvidenciaDemanda | undefined {
  const ticket = ticketAtualDaEtapa(ag, etapa, undefined, (t) => t.estado === "concluido");
  return ticket && ag.evidencias.find((e) => e.ticket_id === ticket.ticket_id && e.tipo === tipo);
}

/** O impacto na arquitetura que exige `reversao` na `mensagem_pr`: qualquer um declarado que não seja baixo. */
export const impactoExigeReversao = (impacto: unknown): boolean => impacto !== undefined && impacto !== "baixo";

export const Criterio = z.object({
  id: z.string().regex(/^CA-\d+$/),
  dado: z.string().trim().min(1),
  quando: z.string().trim().min(1),
  entao: z.string().trim().min(1),
});

/** Texto livre de até 2.000 caracteres: o mesmo formato do `Motivo` do F1, para campos que não são motivo. */
export const Texto = Motivo;

/**
 * Caminho na worktree, casado com os arquivos alterados por `path.matchesGlob` (F3 §4.4): aceita glob; sem `.` nem
 * `..` como segmento, sem caminho absoluto e sem `/` no fim, formas que nunca casam com um caminho do git.
 */
export const CaminhoRelativo = z
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
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
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

export const RelatorioComplexidade = z
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

export const HTML_UNICO = Arquivos({ classes: ["html"], min: 1, max: 1 });

/** Um comando rodado por um coletor (F3 §6); `log` é o nome do anexo com o stdout e o stderr dele. */
export const ComandoRodado = z.object({
  comando: z.string(),
  codigoSaida: z.number().int().nullable().meta({ description: "null quando estourou o tempo" }),
  estourou: z.boolean(),
  duracaoMs: z.number().int().nonnegative(),
  log: z.string(),
});
export const LOGS = Arquivos({ classes: ["texto"], min: 1 });

/** SHA-1 ou SHA-256 de um commit. */
export const Sha = z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/);
/** Linhas de um arquivo no diff; `null` em arquivo binário, como no F5 §7. */
export const Linhas = z.number().int().nonnegative().nullable();

export const ExplicacaoFitness = z.object({
  explicacoes: z.array(z.object({ nome: Slug, explicacao: z.string().trim().min(1).max(1000) })),
});

export const ComprovacaoCriterios = z.object({
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
export const MensagemPR = z.object({
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
export const AulaCodigo = z.object({
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

export const TestesEstresse = z
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

export const AnaliseSeguranca = z
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

export const LOGS_OPCIONAIS = Arquivos({ classes: ["texto"] });

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
export const CustosRealizados = z.object({
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

const Custo = z.strictObject({
  valor: z.number().nonnegative(),
  // `incompleto`: o valor é só um piso, há consumo sem custo medido.
  situacao: z.enum(["conhecido", "incompleto"]),
});
const TextoNaoVazio = z.string().min(1);

export const ArvorePRsCriteriosCustos = z.strictObject({
  demanda: TextoNaoVazio,
  base: TextoNaoVazio.nullable(),
  pr_final: z.strictObject({ numero: z.number().int().positive(), url: TextoNaoVazio }).nullable(),
  sha_integracao: TextoNaoVazio.nullable(),
  rodadas: z.array(
    z.strictObject({
      rodada: TextoNaoVazio,
      titulo: TextoNaoVazio,
      pr: z.strictObject({ id: TextoNaoVazio, url: TextoNaoVazio }).nullable(),
      criterios: z.array(TextoNaoVazio),
      tickets: z.array(z.strictObject({ ticket: TextoNaoVazio, etapa: TextoNaoVazio, custo: Custo })),
    }),
  ),
  // Tickets que não são de rodada (demanda, planejamento, encerramento).
  tickets_sem_rodada: z.array(z.strictObject({ ticket: TextoNaoVazio, etapa: TextoNaoVazio, custo: Custo })),
  // Dois totais que nunca se somam: o interno vem das execuções da Fabriquinha, o externo de `custos_realizados`.
  custos: z.strictObject({
    internos: Custo,
    externos: z.strictObject({
      sessoes: z.array(z.strictObject({ ferramenta: TextoNaoVazio, sessao: TextoNaoVazio, custo: Custo })),
      total: Custo,
    }),
  }),
});
export type ArvorePRsCriteriosCustos = z.infer<typeof ArvorePRsCriteriosCustos>;

const ItemLimpeza = z.strictObject({
  tipo: z.enum(["worktree", "branch_local", "branch_remota"]),
  alvo: TextoNaoVazio,
});
export const DemonstracaoLimpeza = z.strictObject({
  removidas: z.array(ItemLimpeza),
  sobras: z.array(ItemLimpeza),
  // Regra `nada_sobrou`.
  aprovada: z.boolean(),
});
export type DemonstracaoLimpeza = z.infer<typeof DemonstracaoLimpeza>;
